import type { ClinicProfile } from "../../domain/types.js";
import { buildNonTransactionalReply, isPendingSlotRefinementIntent } from "./agent-decisions.js";
import type { ConversationState } from "./agent-state.js";
import type { ConversationUnderstanding } from "./interpreter.js";
import { normalizeText } from "./intent.js";

const SIDE_EFFECT_CONFIDENCE_THRESHOLD = 0.7;

export type AgentActionType =
  | "handoff"
  | "reply_non_transactional"
  | "answer_pending_faq"
  | "complete_pending_patient_data"
  | "clarify_low_confidence"
  | "refine_pending_slot"
  | "search_slots"
  | "confirm_pending_booking"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "answer_faq"
  | "reply_contextual_fallback";

export type AgentDecision = {
  action: AgentActionType;
  stage: ConversationState["stage"];
  reason: string;
  reply?: {
    kind: "reply";
    text: string;
  };
};

export function decideAgentAction(input: {
  messageText: string;
  state: ConversationState;
  understanding: ConversationUnderstanding;
  clinicProfile?: ClinicProfile;
}): AgentDecision {
  const { messageText, state, understanding } = input;

  if (
    understanding.requiresHuman ||
    understanding.intent === "medical_safety" ||
    understanding.intent === "handoff" ||
    hasMedicalSafetyLanguage(messageText)
  ) {
    return decision(state, "handoff", "Safety or human handoff precondition matched.");
  }

  const nonTransactionalReply = buildNonTransactionalReply({
    messageText,
    clinicProfile: input.clinicProfile
  });
  if (nonTransactionalReply) {
    return decision(state, "reply_non_transactional", "Non-transactional smalltalk or catalog request matched.", {
      reply: nonTransactionalReply
    });
  }

  if (state.hasPendingBooking && understanding.intent === "question" && hasRequestedFaqTopic(understanding)) {
    return decision(state, "answer_pending_faq", "Question should be answered against the pending booking context.");
  }

  if (state.hasPendingBooking && canCompletePendingPatientData(messageText, understanding)) {
    return decision(state, "complete_pending_patient_data", "Pending booking is waiting for patient data.");
  }

  if (isLowConfidenceSideEffectIntent(understanding)) {
    return decision(state, "clarify_low_confidence", "Low-confidence side-effect intent cannot execute.");
  }

  if (state.hasPendingBooking && isPendingSlotRefinementIntent(understanding)) {
    return decision(state, "refine_pending_slot", "Pending booking slot refinement matched.");
  }

  if (understanding.intent === "book") {
    return decision(state, "search_slots", "Booking intent should search availability.");
  }

  if (understanding.intent === "confirm") {
    return decision(state, "confirm_pending_booking", "Confirmation intent should confirm the pending booking.");
  }

  if (understanding.intent === "cancel") {
    return decision(state, "cancel_appointment", "Cancellation intent should cancel an active appointment.");
  }

  if (understanding.intent === "reschedule") {
    return decision(state, "reschedule_appointment", "Reschedule intent should search a replacement appointment.");
  }

  if (understanding.intent === "question") {
    return decision(state, "answer_faq", "Question intent should be answered from configured clinic context.");
  }

  return decision(state, "reply_contextual_fallback", "No actionable or answerable intent matched.");
}

export function isLowConfidenceSideEffectIntent(intent: ConversationUnderstanding) {
  if (intent.confidence >= SIDE_EFFECT_CONFIDENCE_THRESHOLD) {
    return false;
  }

  return (
    intent.intent === "book" ||
    intent.intent === "confirm" ||
    intent.intent === "cancel" ||
    intent.intent === "reschedule"
  );
}

export function hasMedicalSafetyLanguage(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("embaraz") ||
    normalized.includes("me duele") ||
    normalized.includes("dolor") ||
    normalized.includes("sangrado") ||
    normalized.includes("fiebre") ||
    normalized.includes("infeccion") ||
    normalized.includes("infectad") ||
    normalized.includes("hinchad") ||
    normalized.includes("reaccion") ||
    normalized.includes("alerg") ||
    normalized.includes("me recomendas") ||
    normalized.includes("puedo hacerme")
  );
}

function decision(
  state: ConversationState,
  action: AgentActionType,
  reason: string,
  extra: Partial<AgentDecision> = {}
): AgentDecision {
  return {
    action,
    stage: state.stage,
    reason,
    ...extra
  };
}

function hasRequestedFaqTopic(intent: ConversationUnderstanding) {
  return intent.requestedTopics.length > 0;
}

function canCompletePendingPatientData(text: string, intent: ConversationUnderstanding) {
  if (intent.requiresHuman || hasMedicalSafetyLanguage(text) || hasOperationalActionLanguage(text)) {
    return false;
  }

  if (intent.provider === "fallback") {
    return false;
  }

  if (intent.provider === "openai") {
    return intent.confidence >= SIDE_EFFECT_CONFIDENCE_THRESHOLD && looksLikeFullName(intent.patientFullName ?? "");
  }

  return intent.intent === "question" && looksLikeFullName(text);
}

function hasOperationalActionLanguage(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("turno") ||
    normalized.includes("reserv") ||
    normalized.includes("agend") ||
    normalized.includes("cancel") ||
    normalized.includes("anular") ||
    normalized.includes("reprogram") ||
    normalized.includes("cambiar") ||
    normalized.includes("confirm")
  );
}

function looksLikeFullName(text: string) {
  const normalized = text.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 5 && normalized.split(" ").length >= 2;
}
