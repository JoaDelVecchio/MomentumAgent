import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding,
  RequestedTopic
} from "./interpreter.js";
import { interpretIntent, normalizeText } from "./intent.js";
import { findMentionedService, findProfessional } from "./service-matching.js";

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
    const normalizedTimePreference = detectNormalizedTimePreference(normalized, input.now);

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

function detectNormalizedTimePreference(normalized: string, now: Date) {
  const dateRange = detectDateRange(normalized, now);
  const daypart = detectDaypart(normalized);
  if (!dateRange && !daypart) {
    return null;
  }

  return {
    ...(dateRange ?? {}),
    ...(daypart ? { daypart } : {})
  };
}

function detectDaypart(normalized: string): "morning" | "afternoon" | "evening" | undefined {
  if (containsAny(normalized, ["tarde", "mediodia"])) {
    return "afternoon";
  }
  if (containsAny(normalized, ["noche", "ultima hora"])) {
    return "evening";
  }
  if (containsAny(normalized, ["a la manana", "por la manana", "temprano"])) {
    return "morning";
  }
  return undefined;
}

function detectDateRange(normalized: string, now: Date) {
  if (normalized.includes("pasado manana")) {
    return buildRelativeDayRange(now, 2);
  }

  if (normalized.includes("manana") && !containsAny(normalized, ["a la manana", "por la manana"])) {
    return buildRelativeDayRange(now, 1);
  }

  const explicitMonth = normalized.match(
    /\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/
  );
  if (explicitMonth) {
    return buildDayRange({
      day: Number(explicitMonth[1]),
      month: monthNumber(explicitMonth[2]),
      year: now.getUTCFullYear(),
      now,
      rollPastDate: true
    });
  }

  const numeric = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const parsedYear = numeric[3] ? Number(numeric[3]) : now.getUTCFullYear();
    return buildDayRange({
      day: Number(numeric[1]),
      month: Number(numeric[2]) - 1,
      year: parsedYear < 100 ? 2000 + parsedYear : parsedYear,
      now,
      rollPastDate: !numeric[3]
    });
  }

  const dayOnly = normalized.match(/\b(?:el|dia|para) (\d{1,2})\b/);
  if (dayOnly) {
    return buildDayRange({
      day: Number(dayOnly[1]),
      month: now.getUTCMonth(),
      year: now.getUTCFullYear(),
      now,
      rollPastDate: true,
      rollByMonth: true
    });
  }

  return undefined;
}

function buildRelativeDayRange(now: Date, daysFromNow: number) {
  const from = addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), daysFromNow);
  return { from, to: addDays(from, 1) };
}

function buildDayRange(input: {
  day: number;
  month: number;
  year: number;
  now: Date;
  rollPastDate: boolean;
  rollByMonth?: boolean;
}) {
  if (input.day < 1 || input.day > 31 || input.month < 0 || input.month > 11) {
    return undefined;
  }

  let from = new Date(Date.UTC(input.year, input.month, input.day));
  if (
    input.rollPastDate &&
    from < new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()))
  ) {
    from = input.rollByMonth
      ? new Date(Date.UTC(input.year, input.month + 1, input.day))
      : new Date(Date.UTC(input.year + 1, input.month, input.day));
  }
  if (from.getUTCDate() !== input.day) {
    return undefined;
  }

  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function monthNumber(month: string) {
  const months: Record<string, number> = {
    enero: 0,
    febrero: 1,
    marzo: 2,
    abril: 3,
    mayo: 4,
    junio: 5,
    julio: 6,
    agosto: 7,
    septiembre: 8,
    setiembre: 8,
    octubre: 9,
    noviembre: 10,
    diciembre: 11
  };
  return months[month] ?? -1;
}
