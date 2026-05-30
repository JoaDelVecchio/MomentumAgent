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

export function findProfessional(
  profile: ClinicProfile,
  professionalPreference: string | null | undefined
): Professional | undefined {
  const normalizedPreference = normalizeText(professionalPreference ?? "");
  if (!normalizedPreference) {
    return undefined;
  }

  return profile.professionals.find((professional) => {
    const normalizedName = normalizeText(professional.name);
    return normalizedName === normalizedPreference || normalizedName.includes(normalizedPreference);
  });
}

export function formatServiceList(profile: ClinicProfile) {
  return profile.services.map((service) => service.name).join(", ");
}

function matchesKnownAlias(normalizedCandidate: string, normalizedServiceName: string) {
  return normalizedCandidate === "botox" && normalizedServiceName.includes("toxina");
}
