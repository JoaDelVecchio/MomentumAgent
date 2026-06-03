import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
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
  const now = () => new Date("2026-06-01T12:00:00.000Z");

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

  const scheduling = new SchedulingService(repos, calendar, audit, now);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, now, interpreter);
  return { repos, calendar, workflow };
}

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "question",
    confidence: 0.95,
    requestedTopics: [],
    requiresHuman: false,
    reason: "fake",
    ...input
  };
}

class SequenceInterpreter implements ConversationInterpreter {
  readonly inputs: ConversationInterpreterInput[] = [];

  constructor(private readonly results: ConversationUnderstanding[]) {}

  async interpret(input: ConversationInterpreterInput) {
    this.inputs.push(input);
    const next = this.results.shift();
    if (!next) {
      throw new Error(`No fake understanding configured for ${input.messageText}`);
    }
    return next;
  }
}

describe("Momentum Conversational Agent Phase 1", () => {
  it("answers smalltalk during a pending offer without confirming or losing the slot", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({ intent: "question", confidence: 0.95 })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T12:00:00.000Z"), endsAt: new Date("2026-06-02T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });
    const pending = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;
    expect(pending).toEqual(
      expect.objectContaining({
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-02T12:00:00.000Z")
      })
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "como te llamas"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Momentum");
    expect(result.text).toContain("turnos");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      pending
    );
  });

  it("answers the configured service catalog during a pending offer without losing the slot", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({ intent: "unknown", confidence: 0.2 })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T12:00:00.000Z"), endsAt: new Date("2026-06-02T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });
    const pending = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;
    expect(pending).toEqual(
      expect.objectContaining({
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-02T12:00:00.000Z")
      })
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "que servicios ofrecen"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Por ahora puedo ayudarte con: Botox."
    });
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      pending
    );
  });

  it("handles natural follow-ups like a real conversation while a Botox offer is pending", async () => {
    const { calendar, repos, workflow } = buildContext(new RulesConversationInterpreter());
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-03T16:00:00.000Z"), endsAt: new Date("2026-06-03T16:30:00.000Z") },
      { startsAt: new Date("2026-06-07T14:00:00.000Z"), endsAt: new Date("2026-06-07T14:30:00.000Z") }
    ]);

    const offer = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_real",
      patientId: "pat_real",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });
    expect(offer.kind).toBe("reply");
    expect(offer.text).toContain("13:00");

    const smalltalk = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_real",
      patientId: "pat_real",
      whatsappNumber: "+5491111111111",
      text: "como te llamas"
    });
    expect(smalltalk).toEqual({
      kind: "reply",
      text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
    });

    const dateFollowUp = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_real",
      patientId: "pat_real",
      whatsappNumber: "+5491111111111",
      text: "que turnos tene sel 7 de junio"
    });
    expect(dateFollowUp.kind).toBe("reply");
    expect(dateFollowUp.text).toContain("11:00");
    expect(dateFollowUp.text).not.toContain("No encontre ese tratamiento");
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_real" })?.pendingBooking).toEqual(
      expect.objectContaining({
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-07T14:00:00.000Z")
      })
    );

    const catalog = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_real",
      patientId: "pat_real",
      whatsappNumber: "+5491111111111",
      text: "que servicios tenes"
    });
    expect(catalog).toEqual({
      kind: "reply",
      text: "Por ahora puedo ayudarte con: Botox."
    });
    expect(repos.listAppointmentsByPatient("pat_real")).toEqual([]);
  });

  it("prioritizes medical safety over smalltalk during a pending offer", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({ intent: "question", confidence: 0.95 })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T12:00:00.000Z"), endsAt: new Date("2026-06-02T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "sos un bot? estoy embarazada"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.botPaused).toBe(true);
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("refines a pending offered slot by time preference without requiring the service again", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({
        intent: "slot_refinement",
        serviceName: null,
        timePreference: "a la tarde",
        normalizedTimePreference: { daypart: "afternoon" }
      })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T10:00:00.000Z"), endsAt: new Date("2026-06-02T10:30:00.000Z") },
      { startsAt: new Date("2026-06-02T15:00:00.000Z"), endsAt: new Date("2026-06-02T15:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "tenes algo a la tarde?"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("12:00");
    expect(result.text).not.toContain("Decime que tratamiento");
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      expect.objectContaining({
        startsAt: new Date("2026-06-02T15:00:00.000Z"),
        endsAt: new Date("2026-06-02T15:30:00.000Z")
      })
    );
  });

  it("preserves the appointment id when refining a pending reschedule offer", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({
        intent: "slot_refinement",
        serviceName: null,
        timePreference: "a la tarde",
        normalizedTimePreference: { daypart: "afternoon" }
      })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T10:00:00.000Z"), endsAt: new Date("2026-06-02T10:30:00.000Z") },
      { startsAt: new Date("2026-06-02T15:00:00.000Z"), endsAt: new Date("2026-06-02T15:30:00.000Z") }
    ]);
    await repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        appointmentId: "apt_1",
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-02T10:00:00.000Z"),
        endsAt: new Date("2026-06-02T10:30:00.000Z")
      },
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "tenes algo a la tarde?"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("12:00");
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      expect.objectContaining({
        appointmentId: "apt_1",
        startsAt: new Date("2026-06-02T15:00:00.000Z")
      })
    );
  });
});
