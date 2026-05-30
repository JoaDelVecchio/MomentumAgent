import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { buildApp } from "../src/api/app.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { OnboardingTestModeService } from "../src/application/onboarding/test-mode-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OnboardingTestModeService", () => {
  it("runs a scoped booking message for a setup clinic and marks the test conversation readiness flag", async () => {
    const context = await buildContext();
    context.calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await context.testModeService.runMessage({
      clinicId: "clinic_setup",
      conversationId: "test:clinic_setup",
      patientId: "test_patient:clinic_setup",
      whatsappNumber: "+5490000000000",
      text: "Quiero reservar botox"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Tengo este horario");
    await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
      expect.objectContaining({
        lifecycleState: "setup",
        paymentStatus: "unpaid",
        testConversationPassed: true,
        updatedAt: new Date("2026-06-01T12:00:00.000Z")
      })
    );
  });

  it("does not mark the test conversation readiness flag for handoff results", async () => {
    const context = await buildContext();

    const result = await context.testModeService.runMessage({
      clinicId: "clinic_setup",
      conversationId: "test:clinic_setup",
      patientId: "test_patient:clinic_setup",
      whatsappNumber: "+5490000000000",
      text: "Quiero hablar con una persona"
    });

    expect(result.kind).toBe("handoff");
    await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
      expect.objectContaining({ testConversationPassed: false })
    );
  });

  it("rejects non-test-scoped identities at the service boundary", async () => {
    const context = await buildContext();

    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "prod_conversation",
        patientId: "test_patient:clinic_setup",
        whatsappNumber: "+5490000000000",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_setup",
        patientId: "prod_patient",
        whatsappNumber: "+5490000000000",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_setup",
        patientId: "test_patient:clinic_setup",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
  });

  it("dry-runs confirmation paths without saving appointments or calendar events", async () => {
    const context = await buildContext();
    context.calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    const input = {
      clinicId: "clinic_setup",
      conversationId: "test:clinic_setup",
      patientId: "test_patient:clinic_setup",
      whatsappNumber: "+5490000000000"
    };

    await context.testModeService.runMessage({ ...input, text: "Quiero reservar botox" });
    const result = await context.testModeService.runMessage({ ...input, text: "Ana Gomez" });

    expect(result).toEqual({
      kind: "reply",
      text: "Ese horario ya no esta disponible. Te busco otro horario si queres."
    });
    expect(context.operational.listAppointmentsByPatient("test_patient:clinic_setup")).toEqual([]);
    await expect(context.calendar.getEvent("evt_1", "cal_perez")).resolves.toBeUndefined();
    expect(context.operational.getPatient("prod_patient")).toBeUndefined();
    expect(context.operational.listConversationsByClinic("clinic_setup")).toEqual([
      expect.objectContaining({
        id: "test:clinic_setup",
        patientId: "test_patient:clinic_setup"
      })
    ]);
  });
});

describe("onboarding test mode route", () => {
  it("requires admin auth and runs with default test identifiers when the test mode service is provided", async () => {
    const context = await buildContext();
    const app = buildApp({
      onboarding: {
        adminToken: "secret",
        service: context.onboardingService,
        testModeService: context.testModeService
      }
    });
    context.calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      payload: { text: "Quiero reservar botox" }
    });
    const authorized = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      headers: { authorization: "Bearer secret" },
      payload: { text: "Quiero reservar botox" }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({
      result: expect.objectContaining({
        kind: "reply",
        text: expect.stringContaining("Tengo este horario")
      })
    });
    expect(context.operational.getConversation({ clinicId: "clinic_setup", conversationId: "test:clinic_setup" })).toEqual(
      expect.objectContaining({
        patientId: "test_patient:clinic_setup"
      })
    );
    await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
      expect.objectContaining({ testConversationPassed: true })
    );
    await app.close();
  });

  it("maps unsafe test identities to a bad request", async () => {
    const context = await buildContext();
    const app = buildApp({
      onboarding: {
        adminToken: "secret",
        service: context.onboardingService,
        testModeService: context.testModeService
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      headers: { authorization: "Bearer secret" },
      payload: {
        text: "Quiero reservar botox",
        conversationId: "prod_conversation",
        patientId: "test_patient:clinic_setup",
        whatsappNumber: "+5490000000000"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "unsafe_test_identity" });
    await app.close();
  });

  it("does not register the test mode route unless a test mode service is provided", async () => {
    const context = await buildContext();
    const app = buildApp({
      onboarding: {
        adminToken: "secret",
        service: context.onboardingService
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      headers: { authorization: "Bearer secret" },
      payload: { text: "Quiero reservar botox" }
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

async function buildContext() {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const now = () => new Date("2026-06-01T12:00:00.000Z");
  const onboardingService = new OnboardingService({ onboarding, operational, now });
  const testModeService = new OnboardingTestModeService({ onboarding, operational, audit, calendar, now });

  await onboardingService.createManualClinic({
    clinicId: "clinic_setup",
    clinicName: "Clinica Setup",
    primaryContactName: "Ana Manager",
    primaryContactPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    source: "presencial"
  });
  await onboardingService.saveClinicProfile(
    parseClinicProfile({
      clinicId: "clinic_setup",
      name: "Clinica Setup",
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
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  return { onboarding, operational, audit, calendar, onboardingService, testModeService };
}
