import { normalizeText } from "./intent.js";

const BLOCKED_NAME_TOKENS = [
  "alcohol",
  "botox",
  "cancelar",
  "como",
  "confirmar",
  "cuanto",
  "cuando",
  "cual",
  "cuesta",
  "doctor",
  "doctora",
  "forma",
  "horario",
  "medico",
  "preparar",
  "prepararme",
  "precio",
  "profesional",
  "que",
  "quien",
  "reservar",
  "sale",
  "servicio",
  "seria",
  "tiene",
  "tienen",
  "turno",
  "vale"
];

export function extractLikelyPatientFullName(text: string): string | undefined {
  if (text.includes("?") || text.includes("\u00bf")) {
    return undefined;
  }

  const candidate = stripNameLeadIn(text);
  const normalizedForGuards = normalizeText(candidate);
  if (!normalizedForGuards || hasBlockedNameLanguage(normalizedForGuards)) {
    return undefined;
  }

  return normalizeFullNameIfComplete(candidate);
}

export function normalizeFullNameIfComplete(text: string) {
  const normalized = normalizeFullName(text);
  if (!normalized) {
    return undefined;
  }

  const parts = normalized.split(" ");
  if (parts.length < 2 || parts.length > 5) {
    return undefined;
  }

  return parts.every((part) => part.length >= 2) ? normalized : undefined;
}

function stripNameLeadIn(text: string) {
  return text
    .replace(/^\s*(mi\s+nombre\s+es|me\s+llamo|soy|nombre\s+y\s+apellido\s*:?)\s+/iu, "")
    .trim();
}

function hasBlockedNameLanguage(normalized: string) {
  const tokens = normalized.split(" ");
  return BLOCKED_NAME_TOKENS.some((blocked) =>
    tokens.some((token) => token === blocked || token.includes(blocked))
  );
}

function normalizeFullName(text: string) {
  const normalized = text.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 5 ? normalized : undefined;
}
