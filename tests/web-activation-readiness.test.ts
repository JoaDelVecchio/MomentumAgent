import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { profileChecklistState } from "../apps/web/src/lib/activation-readiness.js";

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

  it("does not expose calendar readiness as a manual onboarding checkbox", async () => {
    const source = await readFile("apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx", "utf8");

    expect(source).not.toContain('{ key: "calendarConnected"');
    expect(source).not.toContain("Calendar connected");
  });
});
