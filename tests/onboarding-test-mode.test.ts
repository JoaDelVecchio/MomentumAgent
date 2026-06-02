import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { buildApp } from "../src/api/app.js";
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";
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
      conversationId: "test:clinic_setup:booking",
      patientId: "test_patient:clinic_setup:booking",
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
      conversationId: "test:clinic_setup:handoff",
      patientId: "test_patient:clinic_setup:handoff",
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
        patientId: "test_patient:clinic_setup:unsafe",
        whatsappNumber: "+5490000000000",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_setup:unsafe",
        patientId: "prod_patient",
        whatsappNumber: "+5490000000000",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_setup:unsafe",
        patientId: "test_patient:clinic_setup:unsafe",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
  });

  it("rejects test identities scoped to a different clinic", async () => {
    const context = await buildContext();

    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_other:session",
        patientId: "test_patient:clinic_setup:session",
        whatsappNumber: "+5490000000000",
        text: "Quiero reservar botox"
      })
    ).rejects.toMatchObject({ code: "unsafe_test_identity" });
    await expect(
      context.testModeService.runMessage({
        clinicId: "clinic_setup",
        conversationId: "test:clinic_setup:session",
        patientId: "test_patient:clinic_other:session",
        whatsappNumber: "+5490000000000",
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
      conversationId: "test:clinic_setup:dry-run",
      patientId: "test_patient:clinic_setup:dry-run",
      whatsappNumber: "+5490000000000"
    };

    await context.testModeService.runMessage({ ...input, text: "Quiero reservar botox" });
    await context.onboarding.updateReadinessFlags({
      clinicId: "clinic_setup",
      testConversationPassed: false,
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });
    const result = await context.testModeService.runMessage({ ...input, text: "Ana Gomez" });

    expect(result).toEqual({
      kind: "reply",
      text: "Dry-run: el turno se podria confirmar para 2026-06-01T13:00:00.000Z. No se creo ningun evento real."
    });
    await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
      expect.objectContaining({ testConversationPassed: true })
    );
    expect(context.operational.listAppointmentsByPatient("test_patient:clinic_setup:dry-run")).toEqual([]);
    await expect(context.calendar.getEvent("evt_1", "cal_perez")).resolves.toBeUndefined();
    expect(context.operational.getPatient("prod_patient")).toBeUndefined();
    expect(context.operational.listConversationsByClinic("clinic_setup")).toEqual([
      expect.objectContaining({
        id: "test:clinic_setup:dry-run",
        patientId: "test_patient:clinic_setup:dry-run"
      })
    ]);
  });

  it("uses an injected interpreter for test mode messages", async () => {
    const context = await buildContext({
      interpreter: new FixedInterpreter({
        provider: "rules",
        intent: "question",
        confidence: 0.99,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Forced question intent."
      })
    });

    const result = await context.testModeService.runMessage({
      clinicId: "clinic_setup",
      conversationId: "test:clinic_setup:interpreter",
      patientId: "test_patient:clinic_setup:interpreter",
      whatsappNumber: "+5490001111111",
      text: "Quiero reservar botox"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno."
    });
  });
});

describe("onboarding test mode route", () => {
  it("requires admin auth and runs with generated default test identifiers when the test mode service is provided", async () => {
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
    const conversations = context.operational.listConversationsByClinic("clinic_setup");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^test:clinic_setup:/),
        patientId: expect.stringMatching(/^test_patient:clinic_setup:/)
      })
    );
    await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
      expect.objectContaining({ testConversationPassed: true })
    );
    await app.close();
  });

  it("generates fresh default test identities for repeated browser runs", async () => {
    const context = await buildContext();
    const receivedInputs: Array<{
      conversationId: string;
      patientId: string;
      whatsappNumber: string;
    }> = [];
    const app = buildApp({
      onboarding: {
        adminToken: "secret",
        service: context.onboardingService,
        testModeService: {
          runMessage: async (input) => {
            receivedInputs.push({
              conversationId: input.conversationId,
              patientId: input.patientId,
              whatsappNumber: input.whatsappNumber
            });
            return { kind: "reply", text: "Tengo este horario: 2026-06-01T13:00:00.000Z" };
          }
        }
      }
    });

    const first = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      headers: { authorization: "Bearer secret" },
      payload: { text: "Quiero reservar botox" }
    });
    const second = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_setup/test-message",
      headers: { authorization: "Bearer secret" },
      payload: { text: "Quiero reservar botox" }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(receivedInputs).toHaveLength(2);
    expect(receivedInputs[0].conversationId).toMatch(/^test:clinic_setup:/);
    expect(receivedInputs[0].patientId).toMatch(/^test_patient:clinic_setup:/);
    expect(receivedInputs[0].whatsappNumber).toMatch(/^\+549000\d+$/);
    expect(receivedInputs[1].conversationId).not.toBe(receivedInputs[0].conversationId);
    expect(receivedInputs[1].patientId).not.toBe(receivedInputs[0].patientId);
    expect(receivedInputs[1].whatsappNumber).not.toBe(receivedInputs[0].whatsappNumber);
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
        patientId: "test_patient:clinic_setup:unsafe-route",
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

async function buildContext(options: { interpreter?: ConversationInterpreter } = {}) {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const now = () => new Date("2026-06-01T12:00:00.000Z");
  const onboardingService = new OnboardingService({ onboarding, operational, now });
  const testModeService = new OnboardingTestModeService({
    onboarding,
    operational,
    audit,
    calendar,
    now,
    interpreter: options.interpreter
  });

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

class FixedInterpreter implements ConversationInterpreter {
  readonly inputs: ConversationInterpreterInput[] = [];

  constructor(private readonly understanding: ConversationUnderstanding) {}

  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    this.inputs.push(input);
    return this.understanding;
  }
}
