import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ConversationControlInput,
  ConversationControlService
} from "../application/conversations/conversation-control-service.js";
import type { Conversation } from "../ports/repositories.js";
import { isAuthorized } from "./internal-auth.js";

const paramsSchema = z.object({
  clinicId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1)
});

const bodySchema = z.object({
  reason: z.string().trim().min(1)
});

export type ConversationControlRoutesOptions = {
  adminToken: string;
  service: Pick<ConversationControlService, "pauseConversation" | "resumeConversation">;
};

export function registerConversationControlRoutes(app: FastifyInstance, options: ConversationControlRoutesOptions) {
  app.post("/internal/onboarding/clinics/:clinicId/conversations/:conversationId/pause", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const input = parseInput(request.params, request.body);
    if (!input) {
      return reply.status(400).send({ error: "invalid_conversation_control_request" });
    }

    try {
      const conversation = await options.service.pauseConversation(input);
      return reply.send({ conversation: serializeConversation(conversation) });
    } catch (error) {
      if (isMissingConversation(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/onboarding/clinics/:clinicId/conversations/:conversationId/resume", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const input = parseInput(request.params, request.body);
    if (!input) {
      return reply.status(400).send({ error: "invalid_conversation_control_request" });
    }

    try {
      const conversation = await options.service.resumeConversation(input);
      return reply.send({ conversation: serializeConversation(conversation) });
    } catch (error) {
      if (isMissingConversation(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
}

function parseInput(paramsInput: unknown, bodyInput: unknown): ConversationControlInput | undefined {
  const params = paramsSchema.safeParse(paramsInput);
  const body = bodySchema.safeParse(bodyInput);
  if (!params.success || !body.success) {
    return undefined;
  }
  return {
    clinicId: params.data.clinicId,
    conversationId: params.data.conversationId,
    reason: body.data.reason
  };
}

function serializeConversation(conversation: Conversation) {
  return {
    id: conversation.id,
    clinicId: conversation.clinicId,
    botPaused: conversation.botPaused
  };
}

function isMissingConversation(error: unknown): boolean {
  return error instanceof Error && /^Conversation .+:.+ not found$/.test(error.message);
}
