import type { ClinicReadinessKey } from "./types.js";

export type ChecklistState = boolean | "unknown";

export function profileChecklistState(input: {
  activationAttempted: boolean;
  activationSucceeded: boolean;
  missing: ClinicReadinessKey[];
}): ChecklistState {
  if (input.activationSucceeded) {
    return true;
  }
  if (!input.activationAttempted) {
    return "unknown";
  }
  return !input.missing.includes("clinic_profile");
}
