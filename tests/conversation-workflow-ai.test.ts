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
});
