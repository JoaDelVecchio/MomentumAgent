import { describe, expect, it } from "vitest";
import { parseReceptionistTurn } from "../src/application/conversations/receptionist-agent.js";

describe("ReceptionistAgent contract", () => {
  it("parses a structured receptionist turn with nullable OpenAI fields", () => {
    const turn = parseReceptionistTurn({
      replyDraft: "Tengo un lugar para Botox. Si te sirve, te lo confirmo.",
      proposedAction: "search_slots",
      confidence: 0.93,
      serviceName: "Botox",
      professionalPreference: null,
      timePreference: null,
      requestedTopics: ["price"],
      patientFullName: null,
      needsHuman: false,
      safetyReason: null,
      reason: "The patient wants to book Botox and asked about price.",
      grounding: ["Botox is configured in the clinic profile."],
      missingFacts: []
    });

    expect(turn).toEqual(
      expect.objectContaining({
        replyDraft: "Tengo un lugar para Botox. Si te sirve, te lo confirmo.",
        proposedAction: "search_slots",
        confidence: 0.93,
        serviceName: "Botox",
        requestedTopics: ["price"],
        patientFullName: null,
        needsHuman: false,
        safetyReason: null
      })
    );
  });

  it("accepts the receptionist action allowlist", () => {
    const actions = [
      "reply_only",
      "answer_business_question",
      "search_slots",
      "refine_pending_slot",
      "confirm_pending_booking",
      "collect_patient_data",
      "cancel_appointment",
      "reschedule_appointment",
      "handoff"
    ];

    for (const proposedAction of actions) {
      expect(
        parseReceptionistTurn({
          replyDraft: "Te ayudo desde recepcion.",
          proposedAction,
          confidence: 0.8,
          serviceName: null,
          professionalPreference: null,
          timePreference: null,
          requestedTopics: [],
          patientFullName: null,
          needsHuman: false,
          safetyReason: null,
          reason: `Testing ${proposedAction}.`,
          grounding: [],
          missingFacts: []
        }).proposedAction
      ).toBe(proposedAction);
    }
  });

  it("rejects unknown proposed actions", () => {
    expect(() =>
      parseReceptionistTurn({
        replyDraft: "Listo.",
        proposedAction: "invent_calendar_event",
        confidence: 0.9,
        requestedTopics: [],
        needsHuman: false,
        reason: "Invalid action.",
        grounding: [],
        missingFacts: []
      })
    ).toThrow();
  });
});
