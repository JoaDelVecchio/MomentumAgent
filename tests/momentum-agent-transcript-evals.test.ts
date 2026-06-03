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
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type {
  MomentumAgentTranscriptCase,
  TranscriptScheduledAppointment
} from "./fixtures/momentum-agent-transcripts.js";
import { momentumAgentTranscriptCases } from "./fixtures/momentum-agent-transcripts.js";

describe("Momentum Agent transcript quality gate", () => {
  it.each(momentumAgentTranscriptCases)("$name", async (testCase) => {
    const context = await buildContext(testCase);

    for (const [index, turn] of testCase.turns.entries()) {
      const beforeDecisionCount = (await context.audit.list()).filter((event) => event.type === "agent.decision").length;
      const result = await context.workflow.handleInboundMessage({
        clinicId: "clinic_1",
        conversationId: testCase.conversationId,
        patientId: testCase.patientId,
        whatsappNumber: "+5491111111111",
        text: turn.text
      });

      expect(result.kind).toBe(turn.expectedAction === "handoff" ? "handoff" : "reply");
      for (const fragment of turn.expectedReplyIncludes) {
        expect(result.text).toContain(fragment);
      }
      for (const fragment of turn.expectedReplyExcludes ?? []) {
        expect(result.text).not.toContain(fragment);
      }

      const decisions = (await context.audit.list()).filter((event) => event.type === "agent.decision");
      expect(decisions.length).toBe(beforeDecisionCount + 1);
      expect(decisions[decisions.length - 1]?.metadata).toEqual(
        expect.objectContaining({
          action: turn.expectedAction
        })
      );

      const conversation = context.repos.getConversation({
        clinicId: "clinic_1",
        conversationId: testCase.conversationId
      });
      if (turn.expectedPendingCleared) {
        expect(conversation?.pendingBooking).toBeUndefined();
      }
      if (turn.expectedPendingStartsAt) {
        expect(conversation?.pendingBooking?.startsAt).toEqual(new Date(turn.expectedPendingStartsAt));
      }
      if (typeof turn.expectedBotPaused === "boolean") {
        expect(conversation?.botPaused).toBe(turn.expectedBotPaused);
      }
      if (typeof turn.expectedAppointmentCount === "number") {
        expect(context.repos.listAppointmentsByPatient(testCase.patientId).length).toBe(turn.expectedAppointmentCount);
      }
      if (turn.expectedAppointmentStartsAt) {
        expect(context.repos.listAppointmentsByPatient(testCase.patientId)[0]?.startsAt).toEqual(
          new Date(turn.expectedAppointmentStartsAt)
        );
      }
      if (turn.expectedPatientFullName) {
        expect(context.repos.getPatient(testCase.patientId)?.fullName).toBe(turn.expectedPatientFullName);
      }

      expect(context.interpreter.inputs[index]?.conversationState).not.toBeUndefined();
    }
  });
});

async function buildContext(testCase: MomentumAgentTranscriptCase) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();
  const now = () => new Date("2026-06-01T12:00:00.000Z");
  const interpreter = new SequenceInterpreter(
    testCase.turns.map((turn) => understanding(turn.understanding))
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
          restrictions: ["No se realiza en embarazo."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );
  repos.upsertPatient({
    id: testCase.patientId,
    whatsappNumber: "+5491111111111",
    ...(testCase.initialPatientFullName ? { fullName: testCase.initialPatientFullName } : {})
  });

  for (const calendarId of new Set(testCase.availability.map((slot) => slot.calendarId))) {
    calendar.seedAvailability(
      calendarId,
      testCase.availability
        .filter((slot) => slot.calendarId === calendarId)
        .map((slot) => ({
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt)
        }))
    );
  }
  for (const appointment of testCase.scheduledAppointments ?? []) {
    await seedScheduledAppointment({ appointment, calendar, repos, testCase });
  }

  if (testCase.pendingBooking) {
    repos.saveConversation({
      id: testCase.conversationId,
      clinicId: "clinic_1",
      patientId: testCase.patientId,
      botPaused: false,
      pendingBooking: {
        serviceId: testCase.pendingBooking.serviceId,
        professionalId: testCase.pendingBooking.professionalId,
        startsAt: new Date(testCase.pendingBooking.startsAt),
        endsAt: new Date(testCase.pendingBooking.endsAt)
      },
      createdAt: now(),
      updatedAt: now()
    });
  }

  const scheduling = new SchedulingService(repos, calendar, audit, now);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, now, interpreter);
  return { audit, calendar, interpreter, repos, workflow };
}

async function seedScheduledAppointment(input: {
  appointment: TranscriptScheduledAppointment;
  calendar: FakeCalendar;
  repos: InMemoryRepositories;
  testCase: MomentumAgentTranscriptCase;
}) {
  const event = await input.calendar.createEvent({
    calendarId: "cal_perez",
    summary: `${input.appointment.serviceId} - ${input.testCase.patientId}`,
    startsAt: new Date(input.appointment.startsAt),
    endsAt: new Date(input.appointment.endsAt),
    metadata: {
      appointmentId: input.appointment.id,
      patientId: input.testCase.patientId,
      serviceId: input.appointment.serviceId
    }
  });
  input.repos.saveAppointment({
    id: input.appointment.id,
    clinicId: "clinic_1",
    patientId: input.testCase.patientId,
    serviceId: input.appointment.serviceId,
    professionalId: input.appointment.professionalId,
    calendarEventId: event.id,
    calendarId: "cal_perez",
    startsAt: new Date(input.appointment.startsAt),
    endsAt: new Date(input.appointment.endsAt),
    status: "scheduled"
  });
}

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "unknown",
    confidence: 0.95,
    requestedTopics: [],
    requiresHuman: false,
    reason: "transcript eval",
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
      throw new Error(`No transcript understanding configured for ${input.messageText}`);
    }
    return next;
  }
}
