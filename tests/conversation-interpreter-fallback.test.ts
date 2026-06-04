import { describe, expect, it } from "vitest";
import { FallbackConversationInterpreter } from "../src/application/conversations/fallback-interpreter.js";
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";
import { RulesConversationInterpreter } from "../src/application/conversations/rules-interpreter.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

const input: ConversationInterpreterInput = {
  clinicId: "clinic_1",
  conversationId: "conv_1",
  patientId: "pat_1",
  messageText: "Quiero reservar botox",
  now: new Date("2026-06-01T12:00:00.000Z")
};

const clinicProfile = parseClinicProfile({
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
});

describe("FallbackConversationInterpreter", () => {
  it("returns the primary interpretation when it is usable", async () => {
    const result = await new FallbackConversationInterpreter(
      new FixedInterpreter({
        provider: "openai",
        intent: "book",
        confidence: 0.92,
        serviceName: "Botox",
        requestedTopics: [],
        requiresHuman: false,
        reason: "OpenAI understood booking."
      }),
      new FixedInterpreter({
        provider: "rules",
        intent: "unknown",
        confidence: 0.1,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Fallback."
      })
    ).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "openai", intent: "book" }));
  });

  it("uses the fallback interpreter when the primary returns provider fallback", async () => {
    const fallback = new FixedInterpreter({
      provider: "rules",
      intent: "book",
      confidence: 0.8,
      serviceName: "Botox",
      requestedTopics: [],
      requiresHuman: false,
      reason: "Rules fallback understood booking."
    });

    const result = await new FallbackConversationInterpreter(
      new FixedInterpreter({
        provider: "fallback",
        intent: "unknown",
        confidence: 0,
        requestedTopics: [],
        requiresHuman: false,
        reason: "OpenAI failed."
      }),
      fallback
    ).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "rules", intent: "book", serviceName: "Botox" }));
    expect(result.reason).toContain("Primary provider fallback: OpenAI failed.");
    expect(fallback.calls).toBe(1);
  });

  it("uses the fallback interpreter when the primary throws", async () => {
    const fallback = new FixedInterpreter({
      provider: "rules",
      intent: "question",
      confidence: 0.8,
      requestedTopics: ["price"],
      requiresHuman: false,
      reason: "Rules fallback handled the message."
    });

    const result = await new FallbackConversationInterpreter(new ThrowingInterpreter(), fallback).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "rules", intent: "question" }));
    expect(result.reason).toContain("Primary provider fallback: primary failed");
    expect(fallback.calls).toBe(1);
  });

  it("recovers booking intent for typo-heavy availability messages when OpenAI fails", async () => {
    const result = await new FallbackConversationInterpreter(
      new FixedInterpreter({
        provider: "fallback",
        intent: "unknown",
        confidence: 0,
        requestedTopics: [],
        requiresHuman: false,
        reason: "OpenAI timed out."
      }),
      new RulesConversationInterpreter()
    ).interpret({
      ...input,
      clinicProfile,
      messageText: "botox para maniana?"
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "rules",
        intent: "book",
        serviceName: "Botox"
      })
    );
    expect(result.normalizedTimePreference?.from).toEqual(new Date("2026-06-02T03:00:00.000Z"));
    expect(result.normalizedTimePreference?.to).toEqual(new Date("2026-06-03T03:00:00.000Z"));
    expect(result.reason).toContain("Primary provider fallback: OpenAI timed out.");
  });
});

class FixedInterpreter implements ConversationInterpreter {
  calls = 0;

  constructor(private readonly result: ConversationUnderstanding) {}

  async interpret(): Promise<ConversationUnderstanding> {
    this.calls += 1;
    return this.result;
  }
}

class ThrowingInterpreter implements ConversationInterpreter {
  async interpret(): Promise<ConversationUnderstanding> {
    throw new Error("primary failed");
  }
}
