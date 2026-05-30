import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { buildApp } from "../src/api/app.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { readAdminConfig } from "../src/config/admin.js";

describe("onboarding routes", () => {
  it("accepts public landing leads without admin auth", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      payload: leadPayload()
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      lead: expect.objectContaining({
        id: expect.stringMatching(/^lead_/),
        clinicName: "Clinica Norte",
        status: "lead",
        source: "landing"
      })
    });
    await app.close();
  });

  it("rejects invalid public landing leads", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      payload: { ...leadPayload(), professionalCount: 0 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_lead" });
    await app.close();
  });

  it("protects internal onboarding routes with the admin token", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/internal/onboarding/leads"
    });
    const authorized = await app.inject({
      method: "GET",
      url: "/internal/onboarding/leads",
      headers: { authorization: "Bearer secret" }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({ leads: [] });
    await app.close();
  });

  it("creates manual clinics and activates only ready paid clinics", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const create = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics",
      headers: { authorization: "Bearer secret" },
      payload: manualClinicPayload()
    });
    const activation = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/activate",
      headers: { authorization: "Bearer secret" }
    });

    expect(create.statusCode).toBe(201);
    expect(create.json()).toEqual({
      setup: expect.objectContaining({ clinicId: "clinic_1", lifecycleState: "setup" })
    });
    expect(activation.statusCode).toBe(409);
    expect(activation.json()).toEqual({
      error: "clinic_not_ready",
      missing: ["clinic_profile", "payment", "whatsapp", "calendar", "test_conversation", "activation_checklist"]
    });
    await app.close();
  });

  it("returns not found when activating a missing clinic", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const activation = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/missing/activate",
      headers: { authorization: "Bearer secret" }
    });

    expect(activation.statusCode).toBe(404);
    expect(activation.json()).toEqual({ error: "not_found" });
    await app.close();
  });

  it("converts leads and updates clinic payment and readiness flags", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const lead = await app.inject({ method: "POST", url: "/leads", payload: leadPayload() });
    const leadId = lead.json<{ lead: { id: string } }>().lead.id;
    const converted = await app.inject({
      method: "POST",
      url: `/internal/onboarding/leads/${leadId}/convert`,
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_from_lead" }
    });
    const payment = await app.inject({
      method: "PATCH",
      url: "/internal/onboarding/clinics/clinic_from_lead/payment",
      headers: { authorization: "Bearer secret" },
      payload: { paymentStatus: "trial" }
    });
    const readiness = await app.inject({
      method: "PATCH",
      url: "/internal/onboarding/clinics/clinic_from_lead/readiness",
      headers: { authorization: "Bearer secret" },
      payload: {
        whatsappReady: true,
        calendarConnected: true,
        testConversationPassed: true,
        activationChecklistCompleted: true
      }
    });
    const clinic = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_from_lead",
      headers: { authorization: "Bearer secret" }
    });

    expect(converted.statusCode).toBe(201);
    expect(converted.json()).toEqual({
      setup: expect.objectContaining({ clinicId: "clinic_from_lead", leadId, source: "landing" })
    });
    expect(payment.statusCode).toBe(200);
    expect(payment.json()).toEqual({
      setup: expect.objectContaining({ clinicId: "clinic_from_lead", paymentStatus: "trial" })
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({
      setup: expect.objectContaining({
        whatsappReady: true,
        calendarConnected: true,
        testConversationPassed: true,
        activationChecklistCompleted: true
      })
    });
    expect(clinic.statusCode).toBe(200);
    expect(clinic.json()).toEqual({
      setup: expect.objectContaining({ clinicId: "clinic_from_lead", paymentStatus: "trial" })
    });
    await app.close();
  });

  it("saves a real clinic profile through internal onboarding", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "PUT",
      url: "/internal/onboarding/clinics/clinic_1/profile",
      headers: { authorization: "Bearer secret" },
      payload: clinicProfilePayload()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ profile: expect.objectContaining({ clinicId: "clinic_1", name: "Clinica Demo" }) });
    expect(await context.operational.getClinicProfile("clinic_1")).toEqual(
      expect.objectContaining({ clinicId: "clinic_1", services: [expect.objectContaining({ id: "svc_botox" })] })
    );
    await app.close();
  });

  it("rejects invalid clinic profiles through internal onboarding", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "PUT",
      url: "/internal/onboarding/clinics/clinic_1/profile",
      headers: { authorization: "Bearer secret" },
      payload: { ...clinicProfilePayload(), timezone: "Argentina" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_clinic_profile" });
    expect(await context.operational.getClinicProfile("clinic_1")).toBeUndefined();
    await app.close();
  });

  it("uses the path clinic id when profile payload includes a different clinic id", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "PUT",
      url: "/internal/onboarding/clinics/clinic_1/profile",
      headers: { authorization: "Bearer secret" },
      payload: { ...clinicProfilePayload(), clinicId: "client_supplied" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ profile: expect.objectContaining({ clinicId: "clinic_1" }) });
    expect(await context.operational.getClinicProfile("clinic_1")).toEqual(
      expect.objectContaining({ clinicId: "clinic_1" })
    );
    expect(await context.operational.getClinicProfile("client_supplied")).toBeUndefined();
    await app.close();
  });

  it("does not register onboarding routes when options are omitted", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "POST", url: "/leads", payload: leadPayload() });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("admin config", () => {
  it("trims admin tokens and disables blank tokens", () => {
    expect(readAdminConfig({ MOMENTUM_ADMIN_TOKEN: "  secret  " })).toEqual({ enabled: true, token: "secret" });
    expect(readAdminConfig({ MOMENTUM_ADMIN_TOKEN: "   " })).toEqual({ enabled: false });
    expect(readAdminConfig({})).toEqual({ enabled: false });
  });
});

function buildContext() {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const service = new OnboardingService({
    onboarding,
    operational,
    now: () => new Date("2026-06-01T12:00:00.000Z")
  });
  return { onboarding, operational, service };
}

function leadPayload() {
  return {
    contactName: "Ana Manager",
    clinicName: "Clinica Norte",
    whatsappOrPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    professionalCount: 3,
    currentSchedulingSystem: "Google Calendar",
    monthlyWhatsappInquiries: "200-500",
    mainPain: "missed_leads"
  };
}

function manualClinicPayload() {
  return {
    clinicId: "clinic_1",
    clinicName: "Clinica Demo",
    primaryContactName: "Ana Manager",
    primaryContactPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    source: "presencial"
  };
}

function clinicProfilePayload() {
  return {
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        durationMinutes: 30,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: [],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  };
}
