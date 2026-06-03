import { z } from "zod";
import type { ClinicProfile } from "../../domain/types.js";
import type { PendingBooking } from "../../ports/repositories.js";
import type { ConversationState } from "./agent-state.js";

export const requestedTopicSchema = z.enum([
  "price",
  "duration",
  "preparation",
  "restrictions",
  "payment",
  "insurance",
  "other"
]);

export const conversationUnderstandingSchema = z.object({
  provider: z.enum(["rules", "openai", "fallback"]),
  intent: z.enum([
    "book",
    "confirm",
    "reschedule",
    "cancel",
    "question",
    "smalltalk",
    "services_catalog",
    "slot_refinement",
    "handoff",
    "medical_safety",
    "unknown"
  ]),
  confidence: z.number().min(0).max(1),
  serviceName: z.string().min(1).nullable().optional(),
  professionalPreference: z.string().min(1).nullable().optional(),
  timePreference: z.string().min(1).nullable().optional(),
  normalizedTimePreference: z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      daypart: z.enum(["morning", "afternoon", "evening"]).optional()
    })
    .nullable()
    .optional(),
  requestedTopics: z.array(requestedTopicSchema).default([]),
  patientFullName: z.string().min(1).nullable().optional(),
  requiresHuman: z.boolean(),
  safetyReason: z.string().min(1).nullable().optional(),
  reason: z.string().min(1)
});

export type RequestedTopic = z.infer<typeof requestedTopicSchema>;
export type ConversationUnderstanding = z.infer<typeof conversationUnderstandingSchema>;

export type ConversationInterpreterInput = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  messageText: string;
  now: Date;
  clinicProfile?: ClinicProfile;
  pendingBooking?: PendingBooking;
  conversationState?: ConversationState;
};

export interface ConversationInterpreter {
  interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding>;
}

export function parseConversationUnderstanding(value: unknown): ConversationUnderstanding {
  return conversationUnderstandingSchema.parse(value);
}
