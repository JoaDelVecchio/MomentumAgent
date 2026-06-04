import { normalizeText } from "./intent.js";

const BLOCKED_NAME_TOKENS = [
  "alcohol",
  "botox",
  "boluda",
  "boludo",
  "cancelar",
  "como",
  "confirmar",
  "cuanto",
  "cuando",
  "cual",
  "cuesta",
  "doctor",
  "doctora",
  "forra",
  "forro",
  "forma",
  "gil",
  "horario",
  "idiota",
  "medico",
  "mierda",
  "pelotuda",
  "pelotudo",
  "preparar",
  "prepararme",
  "precio",
  "profesional",
  "puta",
  "puto",
  "que",
  "quien",
  "reservar",
  "sale",
  "servicio",
  "seria",
  "tiene",
  "tienen",
  "trola",
  "trolo",
  "turno",
  "vale"
];

const BLOCKED_NAME_EXACT_TOKENS = [
  "anda",
  "andan",
  "estoy",
  "es",
  "hay",
  "me",
  "mi",
  "quiero",
  "soy",
  "tengo",
  "un",
  "una",
  "voy"
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
  if (BLOCKED_NAME_EXACT_TOKENS.some((blocked) => tokens.includes(blocked))) {
    return true;
  }
  return BLOCKED_NAME_TOKENS.some((blocked) =>
    tokens.some((token) => token === blocked || token.includes(blocked))
  );
}

function normalizeFullName(text: string) {
  const normalized = text.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 5 ? normalized : undefined;
}
