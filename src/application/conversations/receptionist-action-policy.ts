import type { ConversationState } from "./agent-state.js";
import { normalizeText } from "./intent.js";
import type { ReceptionistProposedAction, ReceptionistTurn } from "./receptionist-agent.js";

const SIDE_EFFECT_CONFIDENCE_THRESHOLD = 0.7;

export type ReceptionistAllowedAction = ReceptionistProposedAction;

export type ReceptionistActionDecision = {
  proposedAction: ReceptionistProposedAction;
  action: ReceptionistAllowedAction;
  stage: ConversationState["stage"];
  reason: string;
};

export function decideReceptionistAction(input: {
  messageText: string;
  state: ConversationState;
  turn: ReceptionistTurn;
}): ReceptionistActionDecision {
  const { messageText, state, turn } = input;

  if (turn.needsHuman || turn.proposedAction === "handoff" || hasMedicalSafetyLanguage(messageText)) {
    return decision(state, turn.proposedAction, "handoff", "Human handoff or medical safety matched.");
  }

  if (hasAbusiveOrIrrelevantLanguage(messageText) && isSideEffectAction(turn.proposedAction)) {
    return decision(state, turn.proposedAction, "reply_only", "Abusive or irrelevant text cannot trigger side effects.");
  }

  if (isLowConfidenceSideEffect(turn)) {
    return decision(state, turn.proposedAction, "reply_only", "Low-confidence side effect was downgraded.");
  }

  switch (turn.proposedAction) {
    case "reply_only":
    case "answer_business_question":
      return decision(state, turn.proposedAction, turn.proposedAction, "Reply-only action is allowed.");

    case "search_slots":
      if (!turn.serviceName) {
        return decision(state, turn.proposedAction, "reply_only", "Slot search requires a service.");
      }
      return decision(state, turn.proposedAction, "search_slots", "Slot search preconditions matched.");

    case "refine_pending_slot":
      if (!state.hasPendingBooking) {
        return decision(state, turn.proposedAction, "reply_only", "Slot refinement requires a pending booking.");
      }
      return decision(state, turn.proposedAction, "refine_pending_slot", "Pending slot refinement is allowed.");

    case "confirm_pending_booking":
      if (!state.hasPendingBooking) {
        return decision(state, turn.proposedAction, "reply_only", "Confirmation requires a pending booking.");
      }
      if (!isExplicitPendingAcceptance(messageText)) {
        return decision(state, turn.proposedAction, "reply_only", "Confirmation requires explicit patient acceptance.");
      }
      return decision(state, turn.proposedAction, "confirm_pending_booking", "Explicit pending booking acceptance matched.");

    case "collect_patient_data":
      if (!state.hasPendingBooking) {
        return decision(state, turn.proposedAction, "reply_only", "Patient data collection requires a pending booking.");
      }
      if (!looksLikeFullName(turn.patientFullName ?? "")) {
        return decision(state, turn.proposedAction, "reply_only", "Patient full name is incomplete.");
      }
      if (hasOperationalActionLanguage(messageText) || hasAbusiveOrIrrelevantLanguage(messageText)) {
        return decision(state, turn.proposedAction, "reply_only", "Patient data text was not clean administrative data.");
      }
      return decision(state, turn.proposedAction, "collect_patient_data", "Complete patient data matched.");

    case "cancel_appointment":
      if (!hasClearCancellationLanguage(messageText)) {
        return decision(state, turn.proposedAction, "reply_only", "Cancellation requires clear cancellation language.");
      }
      return decision(state, turn.proposedAction, "cancel_appointment", "Cancellation preconditions matched.");

    case "reschedule_appointment":
      if (!hasClearRescheduleLanguage(messageText)) {
        return decision(state, turn.proposedAction, "reply_only", "Reschedule requires clear reschedule language.");
      }
      return decision(state, turn.proposedAction, "reschedule_appointment", "Reschedule preconditions matched.");
  }
}

function decision(
  state: ConversationState,
  proposedAction: ReceptionistProposedAction,
  action: ReceptionistAllowedAction,
  reason: string
): ReceptionistActionDecision {
  return {
    proposedAction,
    action,
    stage: state.stage,
    reason
  };
}

function isLowConfidenceSideEffect(turn: ReceptionistTurn) {
  return turn.confidence < SIDE_EFFECT_CONFIDENCE_THRESHOLD && isSideEffectAction(turn.proposedAction);
}

function isSideEffectAction(action: ReceptionistProposedAction) {
  return (
    action === "search_slots" ||
    action === "refine_pending_slot" ||
    action === "confirm_pending_booking" ||
    action === "collect_patient_data" ||
    action === "cancel_appointment" ||
    action === "reschedule_appointment"
  );
}

function isExplicitPendingAcceptance(text: string) {
  const normalized = normalizeText(text);
  if (hasAbusiveOrIrrelevantLanguage(normalized) || hasMedicalSafetyLanguage(normalized)) {
    return false;
  }

  return (
    normalized === "si" ||
    normalized === "si gracias" ||
    normalized === "dale" ||
    normalized === "ok dale" ||
    normalized === "listo" ||
    normalized === "perfecto" ||
    normalized.includes("agendalo") ||
    normalized.includes("reservalo") ||
    normalized.includes("confirmalo") ||
    normalized.includes("confirmo") ||
    normalized.includes("me sirve") ||
    normalized.includes("ese esta bien") ||
    normalized.includes("ese me va") ||
    normalized.includes("ese horario")
  );
}

function hasClearCancellationLanguage(text: string) {
  const normalized = normalizeText(text);
  return normalized.includes("cancel") || normalized.includes("anular") || normalized.includes("dar de baja");
}

function hasClearRescheduleLanguage(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("reprogram") ||
    normalized.includes("cambiar mi turno") ||
    normalized.includes("cambiar el turno") ||
    normalized.includes("mover mi turno") ||
    normalized.includes("pasar mi turno")
  );
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

function hasMedicalSafetyLanguage(text: string) {
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
    (normalized.includes("me recomendas") && hasTreatmentOrClinicalLanguage(normalized)) ||
    normalized.includes("puedo hacerme")
  );
}

function hasTreatmentOrClinicalLanguage(normalized: string) {
  return (
    normalized.includes("botox") ||
    normalized.includes("tratamiento") ||
    normalized.includes("hacerme") ||
    normalized.includes("aplicarme") ||
    normalized.includes("ponerme") ||
    normalized.includes("relleno") ||
    normalized.includes("toxina")
  );
}

function hasAbusiveOrIrrelevantLanguage(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("trolo") ||
    normalized.includes("puto") ||
    normalized.includes("pelotudo") ||
    normalized.includes("forro") ||
    normalized.includes("mierda")
  );
}

function looksLikeFullName(text: string) {
  const normalized = text.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 5 && normalized.split(" ").length >= 2;
}
