import type { ClinicProfile, Service } from "../../domain/types.js";
import type { ConversationUnderstanding, RequestedTopic } from "./interpreter.js";
import { findService } from "./service-matching.js";

export function buildFaqResponse(
  profile: ClinicProfile | undefined,
  understanding: ConversationUnderstanding
): string | undefined {
  if (!profile) {
    return "No tengo la agenda configurada para esta clinica todavia.";
  }

  if (understanding.requestedTopics.includes("insurance") || understanding.requestedTopics.includes("payment")) {
    return "No tengo ese dato configurado para responderlo con seguridad. Te derivo con recepcion si queres confirmarlo.";
  }

  const service = findService(profile, understanding.serviceName);
  if (!service) {
    return undefined;
  }

  const parts = buildServiceFactParts(service, understanding.requestedTopics);
  if (parts.length === 0) {
    return undefined;
  }

  return `${service.name}: ${parts.join(" ")}`;
}

function buildServiceFactParts(service: Service, topics: RequestedTopic[]) {
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

  return parts;
}
