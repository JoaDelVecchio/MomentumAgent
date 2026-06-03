import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { buildFaqResponse } from "../src/application/conversations/faq-response.js";
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";
import { RulesConversationInterpreter } from "../src/application/conversations/rules-interpreter.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

function buildContext(interpreter: ConversationInterpreter) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();

  repos.upsertClinicProfile(
    parseClinicProfile({
      clinicId: "clinic_1",
      name: "Clinica Demo",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "Evitar alcohol 24 horas antes.",
          restrictions: ["No se realiza en embarazo."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
  const workflow = new ConversationWorkflow(
    repos,
    scheduling,
    audit,
    () => new Date("2026-05-29T12:00:00.000Z"),
    interpreter
  );

  return { repos, calendar, audit, workflow };
}

const pendingNameFallback =
  "Para confirmar el turno necesito nombre y apellido. Tambien puedo responderte dudas antes de confirmarlo.";

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "question",
    confidence: 0.91,
    requestedTopics: [],
    requiresHuman: false,
    reason: "fake",
    ...input
  };
}

class FakeInterpreter implements ConversationInterpreter {
  constructor(private readonly result: ConversationUnderstanding) {}

  async interpret(_input: ConversationInterpreterInput) {
    return this.result;
  }
}

describe("ConversationWorkflow with AI understanding", () => {
  it("does not return partial service FAQ when a requested configured fact is missing", () => {
    const profile = parseClinicProfile({
      clinicId: "clinic_1",
      name: "Clinica Demo",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "",
          restrictions: [],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    });

    expect(
      buildFaqResponse(
        profile,
        understanding({
          serviceName: "Botox",
          requestedTopics: ["price", "restrictions"]
        })
      )
    ).toBeUndefined();
    expect(
      buildFaqResponse(
        profile,
        understanding({
          serviceName: "Botox",
          requestedTopics: ["price", "preparation"]
        })
      )
    ).toBeUndefined();
  });

  it("does not return partial service FAQ when a requested topic is unsupported", () => {
    const profile = parseClinicProfile({
      clinicId: "clinic_1",
      name: "Clinica Demo",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "Evitar alcohol 24 horas antes.",
          restrictions: ["No se realiza en embarazo."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    });

    expect(
      buildFaqResponse(
        profile,
        understanding({
          serviceName: "Botox",
          requestedTopics: ["price", "other"]
        })
      )
    ).toBeUndefined();
  });

  it("uses a safe fallback when a requested configured FAQ fact is missing", async () => {
    const { repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "question",
          serviceName: "Botox",
          requestedTopics: ["price", "restrictions"]
        })
      )
    );
    repos.upsertClinicProfile(
      parseClinicProfile({
        clinicId: "clinic_1",
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
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
        requiredPatientFields: ["fullName"]
      })
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Tiene restricciones botox?"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No tengo ese dato configurado para responderlo con seguridad. Te derivo con recepcion si queres confirmarlo."
    });
  });

  it("answers service FAQ from configured clinic data only", async () => {
    const { workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "question",
          serviceName: "Botox",
          requestedTopics: ["price", "duration", "preparation", "restrictions"]
        })
      )
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Cuanto sale botox y que tengo que hacer antes?"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Botox");
    expect(result.text).toContain("Desde $120.000");
    expect(result.text).toContain("30 minutos");
    expect(result.text).toContain("Evitar alcohol 24 horas antes.");
    expect(result.text).toContain("No se realiza en embarazo.");
  });

  it("does not invent missing insurance or payment data", async () => {
    const { workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "question",
          serviceName: "Botox",
          requestedTopics: ["insurance"]
        })
      )
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Aceptan obra social?"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No tengo ese dato configurado para responderlo con seguridad. Te derivo con recepcion si queres confirmarlo."
    });
  });

  it("pauses the bot for medical safety cases", async () => {
    const { repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "medical_safety",
          confidence: 0.96,
          requiresHuman: true,
          safetyReason: "personalized_medical_advice"
        })
      )
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Estoy embarazada, me recomendas botox?"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).toEqual(
      expect.objectContaining({
        botPaused: true,
        updatedAt: new Date("2026-05-29T12:00:00.000Z")
      })
    );
  });

  it("does not cancel an appointment from a low-confidence cancel intent", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "cancel",
          confidence: 0.1
        })
      )
    );
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    const event = await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Botox - pat_1",
      startsAt,
      endsAt,
      metadata: { appointmentId: "appt_1", patientId: "pat_1", serviceId: "svc_botox" }
    });
    repos.saveAppointment({
      id: "appt_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: event.id,
      calendarId: "cal_perez",
      startsAt,
      endsAt,
      status: "scheduled"
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "cancelar"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No llegue a entenderlo con seguridad. Decime si queres reservar, confirmar, cancelar o cambiar un turno."
    });
    expect(repos.getAppointment("appt_1")?.status).toBe("scheduled");
    expect((await calendar.getEvent(event.id, "cal_perez"))?.status).toBe("scheduled");
  });

  it("does not confirm a pending booking from a low-confidence confirm intent", async () => {
    const { repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "confirm",
          confidence: 0.1
        })
      )
    );
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "si"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No llegue a entenderlo con seguridad. Decime si queres reservar, confirmar, cancelar o cambiar un turno."
    });
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
  });

  it("does not treat medical safety text as patient data while waiting for a full name", async () => {
    const { repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "medical_safety",
          confidence: 0.97,
          requiresHuman: true,
          safetyReason: "personalized_medical_advice"
        })
      )
    );
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Estoy embarazada"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.botPaused).toBe(true);
  });

  it("does not treat rule-based medical safety text as patient data while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(new RulesConversationInterpreter());
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Estoy embarazada"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.botPaused).toBe(true);
  });

  it("does not treat fallback unknown output as patient data while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          provider: "fallback",
          intent: "unknown",
          confidence: 0
        })
      )
    );
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Ana Gomez"
    });

    expect(result).toEqual({
      kind: "reply",
      text: pendingNameFallback
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("uses high-confidence OpenAI patientFullName while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "unknown",
          confidence: 0.91,
          patientFullName: "Ana Gomez"
        })
      )
    );
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Mi nombre es Ana Gomez"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Turno confirmado");
    expect(result.text).toContain("10:00");
    expect(repos.getPatient("pat_1")?.fullName).toBe("Ana Gomez");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([
      expect.objectContaining({
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt,
        status: "scheduled"
      })
    ]);
  });

  it("does not use incomplete OpenAI patientFullName while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "unknown",
          confidence: 0.91,
          patientFullName: "Maria"
        })
      )
    );
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Maria"
    });

    expect(result).toEqual({
      kind: "reply",
      text: pendingNameFallback
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("does not use incomplete rule-based full name while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(new RulesConversationInterpreter());
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Maria"
    });

    expect(result).toEqual({
      kind: "reply",
      text: pendingNameFallback
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("does not use low-confidence OpenAI patientFullName while waiting for a full name", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "unknown",
          confidence: 0.1,
          patientFullName: "Ana Gomez"
        })
      )
    );
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    calendar.seedAvailability("cal_perez", [{ startsAt, endsAt }]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt,
        endsAt
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Mi nombre es Ana Gomez"
    });

    expect(result).toEqual({
      kind: "reply",
      text: pendingNameFallback
    });
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("does not offer a slot from a low-confidence booking intent with a service", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "book",
          confidence: 0.1,
          serviceName: "Botox"
        })
      )
    );
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "botox"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No llegue a entenderlo con seguridad. Decime si queres reservar, confirmar, cancelar o cambiar un turno."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toBeUndefined();
  });

  it("does not clear pending booking from a low-confidence booking intent without a service", async () => {
    const { repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "book",
          confidence: 0.1,
          serviceName: null
        })
      )
    );
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "quiero"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No llegue a entenderlo con seguridad. Decime si queres reservar, confirmar, cancelar o cambiar un turno."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
  });

  it("includes configured FAQ facts for mixed booking and question intents", async () => {
    const { calendar, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "book",
          confidence: 0.91,
          serviceName: "Botox",
          requestedTopics: ["price"]
        })
      )
    );
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Cuanto sale botox y tenes algo?"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Botox: precio Desde $120.000.");
    expect(result.text).toContain("Tengo este horario");
    expect(result.text).toContain("10:00");
  });

  it("filters offered booking slots by AI professional preference", async () => {
    const { calendar, repos, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "book",
          serviceName: "Botox",
          professionalPreference: "Dra. Gomez"
        })
      )
    );

    const profile = parseClinicProfile({
      clinicId: "clinic_1",
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
          professionalIds: ["pro_perez", "pro_gomez"]
        }
      ],
      professionals: [
        { id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" },
        { id: "pro_gomez", name: "Dra. Gomez", calendarId: "cal_gomez" }
      ],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    });
    repos.upsertClinicProfile(profile);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    calendar.seedAvailability("cal_gomez", [
      { startsAt: new Date("2026-06-01T15:00:00.000Z"), endsAt: new Date("2026-06-01T15:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero botox con la dra gomez"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("12:00");
    expect(result.text).not.toContain("10:00");
  });

  it("filters offered booking slots by normalized afternoon preference", async () => {
    const { calendar, workflow } = buildContext(
      new FakeInterpreter(
        understanding({
          intent: "book",
          serviceName: "Botox",
          timePreference: "a la tarde",
          normalizedTimePreference: { daypart: "afternoon" }
        })
      )
    );
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T10:00:00.000Z"), endsAt: new Date("2026-06-01T10:30:00.000Z") },
      { startsAt: new Date("2026-06-01T15:00:00.000Z"), endsAt: new Date("2026-06-01T15:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero botox a la tarde"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("12:00");
  });
});
