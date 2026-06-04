import type { ClinicProfile, Service } from "../../domain/types.js";
import type { ConversationUnderstanding, RequestedTopic } from "./interpreter.js";
import { findService } from "./service-matching.js";

export const missingConfiguredFaqResponse =
  "No tengo ese dato configurado para responderlo con seguridad. Te derivo con recepcion si queres confirmarlo.";

export function buildFaqResponse(
  profile: ClinicProfile | undefined,
  understanding: ConversationUnderstanding
): string | undefined {
  if (!profile) {
    return "No tengo la agenda configurada para esta clinica todavia.";
  }

  if (understanding.requestedTopics.includes("insurance") || understanding.requestedTopics.includes("payment")) {
    return missingConfiguredFaqResponse;
  }

  const service = findService(profile, understanding.serviceName);
  if (!service) {
    return undefined;
  }

  if (understanding.requestedTopics.includes("other")) {
    return undefined;
  }

  if (understanding.requestedTopics.length === 0) {
    const parts = buildServiceFactParts(profile, service, ["price", "duration", "preparation", "restrictions"]);
    if (parts.length === 0) {
      return undefined;
    }
    return `${service.name}: ${parts.join(" ")} Si queres, tambien puedo buscarte un turno.`;
  }

  if (!hasAllRequestedServiceFacts(service, understanding.requestedTopics)) {
    return undefined;
  }

  const parts = buildServiceFactParts(profile, service, understanding.requestedTopics);
  if (parts.length === 0) {
    return undefined;
  }

  return `${service.name}: ${parts.join(" ")}`;
}

export function hasRequestedFaqTopic(understanding: ConversationUnderstanding) {
  return understanding.requestedTopics.length > 0;
}

function hasAllRequestedServiceFacts(service: Service, topics: RequestedTopic[]) {
  const requested = new Set(topics);

  if (requested.has("price") && !service.priceText.trim()) {
    return false;
  }
  if (requested.has("preparation") && !service.preparation.trim()) {
    return false;
  }
  if (requested.has("restrictions") && service.restrictions.length === 0) {
    return false;
  }
  if (requested.has("professional") && service.professionalIds.length === 0) {
    return false;
  }

  return true;
}

function buildServiceFactParts(profile: ClinicProfile, service: Service, topics: RequestedTopic[]) {
  const requested = new Set(topics);
  const parts: string[] = [];

  if (requested.has("price") && service.priceText) {
    parts.push(`precio ${service.priceText}.`);
  }
  if (requested.has("duration")) {
    parts.push(`duracion ${service.durationMinutes} minutos.`);
  }
  if (requested.has("preparation") && service.preparation) {
    parts.push(`preparacion: ${service.preparation}`);
  }
  if (requested.has("restrictions") && service.restrictions.length > 0) {
    parts.push(`restricciones: ${service.restrictions.join(" ")}`);
  }
  if (requested.has("professional")) {
    const professionalNames = service.professionalIds
      .map((professionalId) => profile.professionals.find((professional) => professional.id === professionalId)?.name)
      .filter((name): name is string => Boolean(name));
    if (professionalNames.length > 0) {
      parts.push(`profesionales: ${professionalNames.join(", ")}.`);
    }
  }

  return parts;
}
