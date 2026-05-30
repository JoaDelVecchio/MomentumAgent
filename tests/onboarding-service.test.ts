import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OnboardingService", () => {
  it("submits public leads and converts them into setup clinics", async () => {
    const context = buildContext();

    const lead = await context.service.submitLead({
      contactName: "Ana Manager",
      clinicName: "Clinica Norte",
      whatsappOrPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      professionalCount: 3,
      currentSchedulingSystem: "Google Calendar",
      monthlyWhatsappInquiries: "200-500",
      mainPain: "missed_leads"
    });
    const setup = await context.service.convertLeadToClinic({
      leadId: lead.id,
      clinicId: "clinic_norte",
      now: new Date("2026-06-01T13:00:00.000Z")
    });

    expect(lead).toEqual(
      expect.objectContaining({
        status: "lead",
        source: "landing",
        submittedAt: new Date("2026-06-01T12:00:00.000Z")
      })
    );
    expect(setup).toEqual(
      expect.objectContaining({
        clinicId: "clinic_norte",
        leadId: lead.id,
        source: "landing",
        lifecycleState: "setup",
        paymentStatus: "unpaid",
        primaryContactName: "Ana Manager",
        primaryContactPhone: "+5491111111111",
        city: "Buenos Aires",
        country: "Argentina",
        whatsappReady: false,
        calendarConnected: false,
        testConversationPassed: false,
        activationChecklistCompleted: false,
        updatedAt: new Date("2026-06-01T13:00:00.000Z")
      })
    );
    await expect(context.onboarding.getLead(lead.id)).resolves.toEqual(
      expect.objectContaining({ status: "converted", convertedClinicId: "clinic_norte" })
    );
  });

  it("blocks activation until profile, readiness, payment, and checklist are complete", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "presencial",
      now: new Date("2026-06-01T12:00:00.000Z")
    });

    await expect(context.service.readiness("clinic_1")).resolves.toEqual({
      clinicId: "clinic_1",
      ready: false,
      missing: ["clinic_profile", "payment", "whatsapp", "calendar", "test_conversation", "activation_checklist"]
    });
    await expect(
      context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:01:00.000Z") })
    ).rejects.toThrow(
      "Clinic clinic_1 is not ready to activate: clinic_profile, payment, whatsapp, calendar, test_conversation, activation_checklist"
    );
  });

  it("activates clinics after profile, eligible payment, and readiness flags are complete", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "presencial",
      now: new Date("2026-06-01T12:00:00.000Z")
    });

    await context.service.saveClinicProfile(profile("clinic_1"));
    await context.service.updatePaymentStatus({
      clinicId: "clinic_1",
      paymentStatus: "trial",
      now: new Date("2026-06-01T12:02:00.000Z")
    });
    await context.service.updateReadinessFlags({
      clinicId: "clinic_1",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      now: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(context.service.readiness("clinic_1")).resolves.toEqual({
      clinicId: "clinic_1",
      ready: true,
      missing: []
    });
    await expect(
      context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:04:00.000Z") })
    ).resolves.toEqual(expect.objectContaining({ lifecycleState: "active", paymentStatus: "trial" }));
    await expect(context.service.isClinicActive("clinic_1")).resolves.toBe(true);
  });

  it("blocks activation when the stored profile has no services or professional calendars", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "presencial",
      now: new Date("2026-06-01T12:00:00.000Z")
    });
    context.operational.upsertClinicProfile({ ...profile("clinic_1"), services: [], professionals: [] });
    await context.service.updatePaymentStatus({
      clinicId: "clinic_1",
      paymentStatus: "trial",
      now: new Date("2026-06-01T12:01:00.000Z")
    });
    await context.service.updateReadinessFlags({
      clinicId: "clinic_1",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      now: new Date("2026-06-01T12:02:00.000Z")
    });

    await expect(context.service.readiness("clinic_1")).resolves.toEqual({
      clinicId: "clinic_1",
      ready: false,
      missing: ["clinic_profile"]
    });
    await expect(
      context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:03:00.000Z") })
    ).rejects.toThrow("Clinic clinic_1 is not ready to activate: clinic_profile");
  });

  it("saves and returns clinic profiles", async () => {
    const context = buildContext();

    await expect(context.service.saveClinicProfile(profile("clinic_1"))).resolves.toEqual(
      expect.objectContaining({ clinicId: "clinic_1", name: "Clinica Demo" })
    );
    expect(await context.operational.getClinicProfile("clinic_1")).toEqual(
      expect.objectContaining({ clinicId: "clinic_1", services: [expect.objectContaining({ id: "svc_botox" })] })
    );
  });

  it("pauses active clinics and reports inactive status", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "referido",
      now: new Date("2026-06-01T12:00:00.000Z")
    });
    await context.service.saveClinicProfile(profile("clinic_1"));
    await context.service.updatePaymentStatus({
      clinicId: "clinic_1",
      paymentStatus: "waived",
      now: new Date("2026-06-01T12:01:00.000Z")
    });
    await context.service.updateReadinessFlags({
      clinicId: "clinic_1",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      now: new Date("2026-06-01T12:02:00.000Z")
    });
    await context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:03:00.000Z") });

    const paused = await context.service.pauseClinic({
      clinicId: "clinic_1",
      now: new Date("2026-06-01T12:04:00.000Z")
    });

    expect(paused).toEqual(expect.objectContaining({ lifecycleState: "paused", paymentStatus: "waived" }));
    await expect(context.service.isClinicActive("clinic_1")).resolves.toBe(false);
  });

  it("requires a saved clinic profile before reporting a clinic active", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "presencial",
      now: new Date("2026-06-01T12:00:00.000Z")
    });
    await context.service.updatePaymentStatus({
      clinicId: "clinic_1",
      paymentStatus: "paid",
      now: new Date("2026-06-01T12:01:00.000Z")
    });
    await context.service.updateReadinessFlags({
      clinicId: "clinic_1",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      now: new Date("2026-06-01T12:02:00.000Z")
    });
    await context.onboarding.updateClinicLifecycle({
      clinicId: "clinic_1",
      lifecycleState: "active",
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(context.onboarding.isClinicActive("clinic_1")).resolves.toBe(true);
    await expect(context.service.isClinicActive("clinic_1")).resolves.toBe(false);

    await context.service.saveClinicProfile(profile("clinic_1"));

    await expect(context.service.isClinicActive("clinic_1")).resolves.toBe(true);
  });

  it("requires an existing setup before updating payment status", async () => {
    const context = buildContext();

    await expect(
      context.service.updatePaymentStatus({
        clinicId: "clinic_missing",
        paymentStatus: "paid",
        now: new Date("2026-06-01T12:00:00.000Z")
      })
    ).rejects.toThrow("Clinic setup clinic_missing not found");
  });

  it("upserts clinic knowledge through the onboarding repository", async () => {
    const context = buildContext();

    await context.service.upsertKnowledge({
      id: "knowledge_payment",
      clinicId: "clinic_1",
      category: "payment_methods",
      question: "Como se puede pagar?",
      answer: "Aceptamos transferencia, efectivo y tarjeta.",
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });

    await expect(context.onboarding.listClinicKnowledge("clinic_1")).resolves.toEqual([
      expect.objectContaining({
        id: "knowledge_payment",
        category: "payment_methods",
        answer: "Aceptamos transferencia, efectivo y tarjeta."
      })
    ]);
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

function profile(clinicId: string) {
  return parseClinicProfile({
    clinicId,
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
  });
}
