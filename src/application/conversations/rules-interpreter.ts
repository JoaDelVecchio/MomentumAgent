import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding,
  RequestedTopic
} from "./interpreter.js";
import { interpretIntent, normalizeText } from "./intent.js";

export class RulesConversationInterpreter implements ConversationInterpreter {
  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    const intent = interpretIntent(input.messageText);
    const normalized = normalizeText(input.messageText);

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

    if (intent.type === "book") {
      return {
        provider: "rules",
        intent: "book",
        confidence: intent.serviceName ? 0.8 : 0.65,
        serviceName: intent.serviceName || undefined,
        requestedTopics: [],
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
      normalized.includes("servicios ofrecen") ||
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
      confidence: intent.type === "question" ? 0.45 : 0.75,
      requestedTopics: intent.type === "question" ? detectRequestedTopics(input.messageText) : [],
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

  return topics;
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}
