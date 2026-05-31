import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { ConversationControlInput } from "../src/application/conversations/conversation-control-service.js";
import type { Conversation } from "../src/ports/repositories.js";

describe("conversation control routes", () => {
  it("requires admin auth for pausing a conversation", async () => {
    const fake = new FakeConversationControlService();
    const app = buildApp({ conversationControl: { adminToken: "secret", service: fake } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/pause",
      payload: { reason: "operator_handoff" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(fake.calls).toEqual([]);
    await app.close();
  });

  it("pauses and resumes conversations with reasons", async () => {
    const fake = new FakeConversationControlService();
    const app = buildApp({ conversationControl: { adminToken: "secret", service: fake } });

    const pause = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/pause",
      headers: { authorization: "Bearer secret" },
      payload: { reason: "operator_handoff" }
    });
    const resume = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/resume",
      headers: { authorization: "Bearer secret" },
      payload: { reason: "operator_returned" }
    });

    expect(pause.statusCode).toBe(200);
    expect(pause.json()).toEqual({
      conversation: { id: "conv_1", clinicId: "clinic_1", botPaused: true }
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toEqual({
      conversation: { id: "conv_1", clinicId: "clinic_1", botPaused: false }
    });
    expect(fake.calls).toEqual([
      {
        method: "pauseConversation",
        input: { clinicId: "clinic_1", conversationId: "conv_1", reason: "operator_handoff" }
      },
      {
        method: "resumeConversation",
        input: { clinicId: "clinic_1", conversationId: "conv_1", reason: "operator_returned" }
      }
    ]);
    await app.close();
  });
});

class FakeConversationControlService {
  calls: Array<{ method: "pauseConversation" | "resumeConversation"; input: ConversationControlInput }> = [];

  async pauseConversation(input: ConversationControlInput): Promise<Conversation> {
    this.calls.push({ method: "pauseConversation", input });
    return conversationResponse(input, true);
  }

  async resumeConversation(input: ConversationControlInput): Promise<Conversation> {
    this.calls.push({ method: "resumeConversation", input });
    return conversationResponse(input, false);
  }
}

function conversationResponse(input: ConversationControlInput, botPaused: boolean): Conversation {
  return {
    id: input.conversationId,
    clinicId: input.clinicId,
    patientId: "pat_1",
    botPaused,
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z")
  };
}
