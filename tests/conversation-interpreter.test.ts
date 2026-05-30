import { describe, expect, it } from "vitest";
import { RulesConversationInterpreter } from "../src/application/conversations/rules-interpreter.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import { conversationEvalCases } from "./fixtures/conversation-evals.js";

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

describe("RulesConversationInterpreter", () => {
  it("maps current keyword booking behavior into structured understanding", async () => {
    const result = await new RulesConversationInterpreter().interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "Quiero reservar toxina botulinica",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "rules",
        intent: "book",
        serviceName: "Botox",
        requestedTopics: [],
        requiresHuman: false
      })
    );
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("maps explicit human requests into handoff understanding", async () => {
    const result = await new RulesConversationInterpreter().interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "Quiero hablar con una persona",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "rules",
        intent: "handoff",
        requiresHuman: true,
        safetyReason: "patient_requested_human"
      })
    );
  });

  it.each(
    conversationEvalCases.filter((testCase) => ["reschedule", "handoff"].includes(testCase.expected.intent ?? ""))
  )("covers deterministic eval: $name", async ({ messageText, expected }) => {
    const result = await new RulesConversationInterpreter().interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText,
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile
    });

    expect(result).toEqual(expect.objectContaining(expected));
  });
});
