import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding,
  RequestedTopic
} from "./interpreter.js";
import { interpretIntent, normalizeText } from "./intent.js";
import { findMentionedService, findProfessional } from "./service-matching.js";
import { detectNormalizedTimePreference as detectSharedNormalizedTimePreference } from "./time-preferences.js";

export class RulesConversationInterpreter implements ConversationInterpreter {
  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    const intent = interpretIntent(input.messageText);
    const normalized = normalizeText(input.messageText);
    const mentionedService = input.clinicProfile
      ? findMentionedService(input.clinicProfile, input.messageText)
      : undefined;
    const preferredProfessional = input.clinicProfile
      ? findProfessional(input.clinicProfile, input.messageText)
      : undefined;
    const requestedTopics = detectRequestedTopics(input.messageText);
    const normalizedTimePreference = detectSharedNormalizedTimePreference(
      normalized,
      input.now,
      input.clinicProfile?.timezone
    );

    if (intent.type === "handoff") {
      return {
        provider: "rules",
        intent: "handoff",
        confidence: 0.9,
        requestedTopics: [],
        requiresHuman: true,
        safetyReason: intent.reason,
        reason: "Rule-based human handoff keyword matched."
      };
    }

    if (intent.type === "confirm" && !input.pendingBooking) {
      return {
        provider: "rules",
        intent: "unknown",
        confidence: 0.4,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Rule-based confirmation keyword has no pending booking context."
      };
    }

    if (intent.type === "cancel" || intent.type === "reschedule") {
      return {
        provider: "rules",
        intent: intent.type,
        confidence: 0.75,
        requestedTopics: [],
        requiresHuman: false,
        reason: `Rule-based ${intent.type} keyword matched.`
      };
    }

    if (input.pendingBooking && isPendingAvailabilityQuestion(normalized)) {
      return {
        provider: "rules",
        intent: "slot_refinement",
        confidence: 0.85,
        serviceName: null,
        timePreference: normalizedTimePreference ? input.messageText : null,
        normalizedTimePreference,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Rule-based pending booking availability refinement matched."
      };
    }

    if (mentionedService && isNaturalBookingRequest(normalized)) {
      return {
        provider: "rules",
        intent: "book",
        confidence: 0.78,
        serviceName: mentionedService.name,
        professionalPreference: preferredProfessional?.name,
        timePreference: normalizedTimePreference ? input.messageText : null,
        normalizedTimePreference,
        requestedTopics,
        requiresHuman: false,
        reason: "Rule-based natural booking request matched a configured service."
      };
    }

    if (intent.type === "book") {
      return {
        provider: "rules",
        intent: "book",
        confidence: intent.serviceName || mentionedService ? 0.8 : 0.65,
        serviceName: intent.serviceName || mentionedService?.name || undefined,
        professionalPreference: preferredProfessional?.name,
        timePreference: normalizedTimePreference ? input.messageText : null,
        normalizedTimePreference,
        requestedTopics,
        requiresHuman: false,
        reason: "Rule-based booking keyword matched."
      };
    }

    if (
      normalized.includes("como te llamas") ||
      normalized.includes("quien sos") ||
      normalized.includes("quien eres")
    ) {
      return {
        provider: "rules",
        intent: "smalltalk",
        confidence: 0.9,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Rule-based role smalltalk matched."
      };
    }

    if (
      normalized.includes("que servicios ofrecen") ||
      normalized.includes("que servicios tenes") ||
      normalized.includes("que servicios tienen") ||
      normalized.includes("servicios ofrecen") ||
      normalized.includes("servicios tenes") ||
      normalized.includes("servicios tienen") ||
      normalized.includes("que tratamientos tenes") ||
      normalized.includes("que tratamientos tienen") ||
      normalized.includes("tratamientos ofrecen")
    ) {
      return {
        provider: "rules",
        intent: "services_catalog",
        confidence: 0.9,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Rule-based service catalog question matched."
      };
    }

    return {
      provider: "rules",
      intent: intent.type,
      confidence: intent.type === "question" ? questionConfidence(mentionedService, requestedTopics) : 0.75,
      serviceName: intent.type === "question" ? mentionedService?.name : undefined,
      professionalPreference: preferredProfessional?.name,
      requestedTopics: intent.type === "question" ? requestedTopics : [],
      requiresHuman: false,
      reason: `Rule-based ${intent.type} keyword matched.`
    };
  }
}

function detectRequestedTopics(text: string): RequestedTopic[] {
  const normalized = normalizeText(text);
  const topics: RequestedTopic[] = [];

  if (containsAny(normalized, ["precio", "sale", "vale", "cuesta", "costo", "valor"])) {
    topics.push("price");
  }
  if (containsAny(normalized, ["dura", "duracion", "tiempo tarda", "cuanto tarda"])) {
    topics.push("duration");
  }
  if (containsAny(normalized, ["prepar", "antes", "cuidados previos"])) {
    topics.push("preparation");
  }
  if (containsAny(normalized, ["restric", "contraindic", "puedo hacerme"])) {
    topics.push("restrictions");
  }
  if (containsAny(normalized, ["pago", "tarjeta", "transferencia", "efectivo"])) {
    topics.push("payment");
  }
  if (containsAny(normalized, ["obra social", "prepaga", "seguro"])) {
    topics.push("insurance");
  }
  if (
    containsAny(normalized, [
      "doctor",
      "doctora",
      "dr ",
      "dra ",
      "medico",
      "profesional",
      "quien seria",
      "quien atiende",
      "con quien"
    ])
  ) {
    topics.push("professional");
  }

  return topics;
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function isPendingAvailabilityQuestion(normalized: string) {
  return (
    containsAny(normalized, ["turno", "horario", "disponib", "agenda", "lugar"]) &&
    containsAny(normalized, ["que", "tenes", "tienen", "hay", "para", "otro", "algo", "cuando"])
  );
}

function isNaturalBookingRequest(normalized: string) {
  return (
    containsAny(normalized, [
      "quiero",
      "quisiera",
      "necesito",
      "me quiero hacer",
      "hacerme",
      "ponerme",
      "aplicarme",
      "tenes algo",
      "hay algo",
      "hay turno",
      "disponible",
      "disponibilidad",
      "horario",
      "agenda"
    ]) ||
    containsAny(normalized, ["a la manana", "a la tarde", "a la noche", "manana", "pasado manana"])
  );
}

function questionConfidence(
  mentionedService: ReturnType<typeof findMentionedService>,
  requestedTopics: RequestedTopic[]
) {
  if (mentionedService && requestedTopics.length > 0) {
    return 0.75;
  }
  if (mentionedService) {
    return 0.65;
  }
  return 0.45;
}
