import { describe, expect, it } from "vitest";
import { profileChecklistState } from "../apps/web/src/app/internal/onboarding/clinics/[clinicId]/activation/page.js";

describe("activation profile readiness display", () => {
  it("treats clinic profile as complete when activation missing keys omit it", () => {
    expect(profileChecklistState({ activationAttempted: true, activationSucceeded: false, missing: ["payment"] })).toBe(true);
  });

  it("treats clinic profile as incomplete when activation missing keys include it", () => {
    expect(
      profileChecklistState({
        activationAttempted: true,
        activationSucceeded: false,
        missing: ["clinic_profile", "payment"]
      })
    ).toBe(false);
  });

  it("treats clinic profile as unknown before activation verifies it", () => {
    expect(profileChecklistState({ activationAttempted: false, activationSucceeded: false, missing: [] })).toBe("unknown");
  });
});
