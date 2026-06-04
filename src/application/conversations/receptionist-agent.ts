import { z } from "zod";
import type { Appointment, ClinicProfile } from "../../domain/types.js";
import type { ConversationMessage, PendingBooking } from "../../ports/repositories.js";
import type { ConversationState } from "./agent-state.js";
import { requestedTopicSchema } from "./interpreter.js";

export const receptionistProposedActionSchema = z.enum([
  "reply_only",
  "answer_business_question",
  "search_slots",
  "refine_pending_slot",
  "confirm_pending_booking",
  "collect_patient_data",
  "cancel_appointment",
  "reschedule_appointment",
  "handoff"
]);

export const receptionistTurnSchema = z.object({
  replyDraft: z.string().min(1).max(1200),
  proposedAction: receptionistProposedActionSchema,
  confidence: z.number().min(0).max(1),
  serviceName: z.string().min(1).nullable().optional(),
  professionalPreference: z.string().min(1).nullable().optional(),
  timePreference: z.string().min(1).nullable().optional(),
  requestedTopics: z.array(requestedTopicSchema).default([]),
  patientFullName: z.string().min(1).nullable().optional(),
  needsHuman: z.boolean(),
  safetyReason: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
  grounding: z.array(z.string().min(1)).default([]),
  missingFacts: z.array(z.string().min(1)).default([])
});

export type ReceptionistProposedAction = z.infer<typeof receptionistProposedActionSchema>;
export type ReceptionistTurn = z.infer<typeof receptionistTurnSchema>;

export type ReceptionistAgentInput = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  messageText: string;
  now: Date;
  clinicProfile?: ClinicProfile;
  pendingBooking?: PendingBooking;
  conversationState: ConversationState;
  activeAppointments: Appointment[];
  recentMessages: ConversationMessage[];
};

export interface ReceptionistAgent {
  respond(input: ReceptionistAgentInput): Promise<ReceptionistTurn>;
}

export function parseReceptionistTurn(value: unknown): ReceptionistTurn {
  return receptionistTurnSchema.parse(value);
}
