import type { ClinicProfile } from "../../domain/types.js";
import type { ConversationUnderstanding } from "./interpreter.js";
import { normalizeText } from "./intent.js";
import { formatServiceList } from "./service-matching.js";

export type AgentReplyDecision = {
  kind: "reply";
  text: string;
};

export function buildNonTransactionalReply(input: {
  messageText: string;
  clinicProfile?: ClinicProfile;
}): AgentReplyDecision | undefined {
  const normalized = normalizeText(input.messageText);

  if (hasTransactionalLanguage(normalized)) {
    return undefined;
  }

  if (isRoleSmalltalk(normalized)) {
    return {
      kind: "reply",
      text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
    };
  }

  if (isServiceCatalogQuestion(normalized)) {
    return {
      kind: "reply",
      text: input.clinicProfile
        ? `Por ahora puedo ayudarte con: ${formatServiceList(input.clinicProfile)}.`
        : "Todavia no tengo los servicios configurados para esta clinica."
    };
  }

  return undefined;
}

export function isPendingSlotRefinementIntent(intent: ConversationUnderstanding) {
  return (
    intent.intent === "slot_refinement" ||
    (intent.intent === "book" &&
      !intent.serviceName &&
      Boolean(intent.timePreference || intent.normalizedTimePreference || intent.professionalPreference))
  );
}

function hasTransactionalLanguage(normalized: string) {
  return (
    normalized.includes("reserv") ||
    normalized.includes("turno") ||
    normalized.includes("cita") ||
    normalized.includes("agend") ||
    normalized.includes("sacar") ||
    normalized.includes("confirm") ||
    normalized.includes("cancel") ||
    normalized.includes("reprogram") ||
    normalized.includes("cambiar")
  );
}

function isRoleSmalltalk(normalized: string) {
  return (
    normalized.includes("como te llamas") ||
    normalized.includes("quien sos") ||
    normalized.includes("quien eres") ||
    normalized.includes("sos un bot") ||
    normalized.includes("eres un bot")
  );
}

function isServiceCatalogQuestion(normalized: string) {
  return (
    normalized.includes("que servicios ofrecen") ||
    normalized.includes("que servicios tenes") ||
    normalized.includes("que servicios tienen") ||
    normalized.includes("servicios ofrecen") ||
    normalized.includes("servicios tenes") ||
    normalized.includes("servicios tienen") ||
    normalized.includes("que tratamientos tenes") ||
    normalized.includes("que tratamientos tienen") ||
    normalized.includes("tratamientos ofrecen")
  );
}
