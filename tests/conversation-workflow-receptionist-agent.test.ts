import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import type {
  ReceptionistAgent,
  ReceptionistAgentInput,
  ReceptionistTurn
} from "../src/application/conversations/receptionist-agent.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

function buildContext(turns: ReceptionistTurn[]) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();
  const now = () => new Date("2026-06-01T12:00:00.000Z");
  const receptionistAgent = new SequenceReceptionistAgent(turns);

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
  const workflow = new ConversationWorkflow(repos, scheduling, audit, now, undefined, {
    receptionistAgent
  });

  return { audit, calendar, repos, receptionistAgent, workflow };
}

const baseInput = {
  clinicId: "clinic_1",
  conversationId: "conv_1",
  patientId: "pat_1",
  whatsappNumber: "+5491111111111"
};

describe("ConversationWorkflow receptionist agent path", () => {
  it("keeps a pending Botox slot through price and abusive text, then confirms on explicit agendalo", async () => {
    const { audit, calendar, repos, workflow } = buildContext([
      turn({
        proposedAction: "search_slots",
        serviceName: "Botox",
        replyDraft: "Te busco un horario para Botox."
      }),
      turn({
        proposedAction: "answer_business_question",
        serviceName: "Botox",
        requestedTopics: ["price"],
        replyDraft: "Botox esta desde $120.000. Te mantengo el horario ofrecido; si queres, te lo confirmo."
      }),
      turn({
        proposedAction: "confirm_pending_booking",
        replyDraft: "Turno confirmado para Botox."
      }),
      turn({
        proposedAction: "confirm_pending_booking",
        replyDraft: "Te lo confirmo."
      })
    ]);
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-04T12:00:00.000Z"), endsAt: new Date("2026-06-04T12:30:00.000Z") }
    ]);

    const offer = await workflow.handleInboundMessage({ ...baseInput, text: "Hola, quiero reservar botox." });
    const pendingAfterOffer = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;
    const price = await workflow.handleInboundMessage({ ...baseInput, text: "cuanto esta?" });
    const pendingAfterPrice = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;
    const abusive = await workflow.handleInboundMessage({ ...baseInput, text: "jero es un trolo" });
    const appointmentsAfterAbusive = repos.listAppointmentsByPatient("pat_1");
    const confirmation = await workflow.handleInboundMessage({ ...baseInput, text: "agendalo" });

    expect(offer.text).toContain("Tengo este horario");
    expect(offer.text).toContain("09:00");
    expect(price.text).toContain("$120.000");
    expect(pendingAfterPrice).toEqual(pendingAfterOffer);
    expect(abusive.text).toContain("Te mantengo");
    expect(abusive.text).not.toContain("Turno confirmado");
    expect(appointmentsAfterAbusive).toEqual([]);
    expect(confirmation.text).toContain("Turno confirmado");
    expect(confirmation.text).toContain("09:00");
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toBeUndefined();
    const appointments = repos.listAppointmentsByPatient("pat_1");
    expect(appointments).toEqual([
      expect.objectContaining({
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-04T12:00:00.000Z"),
        status: "scheduled"
      })
    ]);
    await expect(calendar.getEvent(appointments[0]?.calendarEventId ?? "", "cal_perez")).resolves.toEqual(
      expect.objectContaining({
        calendarId: "cal_perez",
        summary: "Botox - pat_1",
        startsAt: new Date("2026-06-04T12:00:00.000Z"),
        endsAt: new Date("2026-06-04T12:30:00.000Z"),
        metadata: {
          appointmentId: appointments[0]?.id,
          patientId: "pat_1",
          serviceId: "svc_botox"
        },
        status: "scheduled"
      })
    );
    expect(await audit.list()).toContainEqual(
      expect.objectContaining({
        type: "receptionist.decision",
        metadata: expect.objectContaining({
          proposedAction: "confirm_pending_booking",
          action: "reply_only"
        })
      })
    );
  });

  it("asks for missing full name before confirming a pending slot", async () => {
    const { calendar, repos, workflow } = buildContext([
      turn({ proposedAction: "search_slots", serviceName: "Botox" }),
      turn({ proposedAction: "confirm_pending_booking" })
    ]);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-04T12:00:00.000Z"), endsAt: new Date("2026-06-04T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({ ...baseInput, text: "quiero botox" });
    const result = await workflow.handleInboundMessage({ ...baseInput, text: "agendalo" });

    expect(result.text).toContain("nombre y apellido");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
  });

  it("does not send a reply-only draft that falsely claims a calendar mutation", async () => {
    const { repos, workflow } = buildContext([
      turn({
        proposedAction: "reply_only",
        replyDraft: "Turno confirmado para Botox."
      })
    ]);
    repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-04T12:00:00.000Z"),
        endsAt: new Date("2026-06-04T12:30:00.000Z")
      },
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });

    const result = await workflow.handleInboundMessage({ ...baseInput, text: "jero es un trolo" });

    expect(result.text).toContain("Te mantengo");
    expect(result.text).not.toContain("Turno confirmado");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("stores a complete patient name and confirms through the receptionist path", async () => {
    const { calendar, repos, workflow } = buildContext([
      turn({ proposedAction: "search_slots", serviceName: "Botox" }),
      turn({ proposedAction: "confirm_pending_booking" }),
      turn({ proposedAction: "collect_patient_data", patientFullName: "Ana Gomez", replyDraft: "Gracias Ana." })
    ]);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-04T12:00:00.000Z"), endsAt: new Date("2026-06-04T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({ ...baseInput, text: "quiero botox" });
    await workflow.handleInboundMessage({ ...baseInput, text: "agendalo" });
    const result = await workflow.handleInboundMessage({ ...baseInput, text: "Ana Gomez" });

    expect(result.text).toContain("Turno confirmado");
    expect(repos.getPatient("pat_1")?.fullName).toBe("Ana Gomez");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([
      expect.objectContaining({ patientId: "pat_1", serviceId: "svc_botox", status: "scheduled" })
    ]);
  });
});

function turn(input: Partial<ReceptionistTurn>): ReceptionistTurn {
  return {
    replyDraft: "Te ayudo desde recepcion.",
    proposedAction: "reply_only",
    confidence: 0.93,
    serviceName: null,
    professionalPreference: null,
    timePreference: null,
    requestedTopics: [],
    patientFullName: null,
    needsHuman: false,
    safetyReason: null,
    reason: "fake receptionist turn",
    grounding: [],
    missingFacts: [],
    ...input
  };
}

class SequenceReceptionistAgent implements ReceptionistAgent {
  readonly inputs: ReceptionistAgentInput[] = [];

  constructor(private readonly turns: ReceptionistTurn[]) {}

  async respond(input: ReceptionistAgentInput) {
    this.inputs.push(input);
    const next = this.turns.shift();
    if (!next) {
      throw new Error(`No receptionist turn configured for ${input.messageText}`);
    }
    return next;
  }
}
