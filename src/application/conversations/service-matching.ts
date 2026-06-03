import type { ClinicProfile, Professional, Service } from "../../domain/types.js";
import { normalizeText } from "./intent.js";

export function findService(profile: ClinicProfile, serviceName: string | null | undefined): Service | undefined {
  const normalizedServiceName = normalizeText(serviceName ?? "");
  if (!normalizedServiceName) {
    return undefined;
  }

  return profile.services.find((service) => {
    const normalizedCandidate = normalizeText(service.name);
    return (
      normalizedCandidate === normalizedServiceName ||
      normalizedCandidate.includes(normalizedServiceName) ||
      normalizedServiceName.includes(normalizedCandidate) ||
      matchesKnownAlias(normalizedCandidate, normalizedServiceName)
    );
  });
}

export function findMentionedService(profile: ClinicProfile, text: string): Service | undefined {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return undefined;
  }

  const matches = profile.services.filter((service) => {
    const normalizedCandidate = normalizeText(service.name);
    return (
      normalizedCandidate.length >= 3 &&
      (normalizedText.includes(normalizedCandidate) || matchesKnownAlias(normalizedCandidate, normalizedText))
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function findProfessional(
  profile: ClinicProfile,
  professionalPreference: string | null | undefined
): Professional | undefined {
  const normalizedPreference = normalizeText(professionalPreference ?? "");
  const specificPreference = removeProfessionalHonorifics(normalizedPreference);
  if (!specificPreference || specificPreference.length < 3) {
    return undefined;
  }

  const matches = profile.professionals.filter((professional) => {
    const normalizedName = normalizeText(professional.name);
    const specificName = removeProfessionalHonorifics(normalizedName);
    return (
      normalizedName === normalizedPreference ||
      normalizedName.includes(specificPreference) ||
      specificName === specificPreference ||
      specificName.includes(specificPreference)
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function formatServiceList(profile: ClinicProfile) {
  return profile.services.map((service) => service.name).join(", ");
}

function matchesKnownAlias(normalizedCandidate: string, normalizedServiceName: string) {
  return normalizedCandidate === "botox" && normalizedServiceName.includes("toxina");
}

function removeProfessionalHonorifics(normalizedText: string) {
  return normalizedText
    .replace(/\b(dra|dr|doctora|doctor|lic|licenciada|licenciado)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
