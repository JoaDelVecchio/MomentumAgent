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

describe("Receptionist agent transcript evals", () => {
  it("answers normal reception-adjacent questions without becoming a menu bot", async () => {
    const context = buildContext([
      turn({
        replyDraft: "No tengo la sala de espera en tiempo real, pero puedo buscarte un horario mas tranquilo si queres.",
        proposedAction: "reply_only"
      }),
      turn({
        replyDraft:
          "Si viajas, podemos buscar un horario que te quede comodo antes del viaje. Para Botox tengo cargado que conviene evitar alcohol 24 horas antes.",
        proposedAction: "reply_only"
      }),
      turn({
        replyDraft: "Es normal estar nerviosa. Te puedo contar cuanto dura el turno y la preparacion, o derivarte con recepcion.",
        proposedAction: "reply_only"
      })
    ]);

    const busy = await context.workflow.handleInboundMessage(message("hay mucha gente?"));
    const vacation = await context.workflow.handleInboundMessage(message("me voy de vacaciones, que me recomendas?"));
    const nervous = await context.workflow.handleInboundMessage(message("estoy medio nerviosa"));

    expect(busy.text).toContain("No tengo la sala de espera en tiempo real");
    expect(vacation.text).toContain("antes del viaje");
    expect(vacation.text).toContain("alcohol 24 horas antes");
    expect(nervous.text).toContain("normal estar nerviosa");
    expect(context.repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("redirects completely out-of-scope ChatGPT-style requests", async () => {
    const context = buildContext([
      turn({
        replyDraft: "En eso no te voy a poder ayudar desde recepcion. Si queres, seguimos con tu consulta o turno en la clinica.",
        proposedAction: "reply_only"
      })
    ]);

    const result = await context.workflow.handleInboundMessage(message("haceme un programa en python"));

    expect(result.text).toContain("desde recepcion");
    expect(result.text).toContain("consulta o turno");
    expect(context.repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("hands off personal medical safety questions", async () => {
    const context = buildContext([
      turn({
        replyDraft: "Prefiero derivarte con recepcion para que lo revise alguien de la clinica.",
        proposedAction: "handoff",
        needsHuman: true,
        safetyReason: "personalized_medical_advice"
      })
    ]);

    const result = await context.workflow.handleInboundMessage(message("estoy embarazada, puedo hacerme botox?"));

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(context.repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.botPaused).toBe(true);
    expect(await context.audit.list()).toContainEqual(
      expect.objectContaining({
        type: "receptionist.decision",
        metadata: expect.objectContaining({ action: "handoff" })
      })
    );
  });
});

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
          restrictions: ["No se realiza en embarazo."],
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

  return { audit, repos, workflow };
}

function message(text: string) {
  return {
    clinicId: "clinic_1",
    conversationId: "conv_1",
    patientId: "pat_1",
    whatsappNumber: "+5491111111111",
    text
  };
}

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
    reason: "fake receptionist transcript turn",
    grounding: [],
    missingFacts: [],
    ...input
  };
}

class SequenceReceptionistAgent implements ReceptionistAgent {
  constructor(private readonly turns: ReceptionistTurn[]) {}

  async respond(input: ReceptionistAgentInput) {
    const next = this.turns.shift();
    if (!next) {
      throw new Error(`No receptionist transcript turn configured for ${input.messageText}`);
    }
    return next;
  }
}
