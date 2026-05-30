export type ConversationIntent =
  | { type: "book"; serviceName: string }
  | { type: "confirm" }
  | { type: "reschedule" }
  | { type: "cancel" }
  | { type: "handoff"; reason: string }
  | { type: "question"; topic: string };

export function interpretIntent(text: string): ConversationIntent {
  const normalized = normalizeText(text);

  if (containsAny(normalized, ["humano", "persona", "recepcion", "asesor"])) {
    return { type: "handoff", reason: "patient_requested_human" };
  }

  if (containsAny(normalized, ["cancel", "anular", "dar de baja"])) {
    return { type: "cancel" };
  }

  if (
    containsAny(normalized, [
      "reprogram",
      "cambiar turno",
      "cambiar mi turno",
      "mover turno",
      "modificar turno",
      "pasar turno",
      "pasar mi turno"
    ])
  ) {
    return { type: "reschedule" };
  }

  if (
    normalized === "si" ||
    normalized === "si gracias" ||
    containsAny(normalized, ["confirmo", "me sirve", "dale", "ok", "perfecto"])
  ) {
    return { type: "confirm" };
  }

  if (containsAny(normalized, ["reserv", "turno", "cita", "agend", "sacar"])) {
    return { type: "book", serviceName: extractServiceName(normalized) };
  }

  return { type: "question", topic: text };
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function extractServiceName(normalizedText: string) {
  if (normalizedText.includes("botox") || normalizedText.includes("toxina")) {
    return "Botox";
  }

  const serviceName = normalizedText
    .replace(
      /\b(quiero|quisiera|necesito|necesitaria|puedo|podria|me|gustaria|reservar|reserva|reservame|turno|cita|agendar|agendarme|sacar|un|una|el|la|para|por|de)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return serviceName;
}
