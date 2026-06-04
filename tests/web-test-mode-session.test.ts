import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestModeSession } from "../apps/web/src/lib/test-mode-session.js";

const testModePage = readFileSync(
  new URL("../apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx", import.meta.url),
  "utf8"
);
const globals = readFileSync(new URL("../apps/web/src/app/globals.css", import.meta.url), "utf8");

describe("createTestModeSession", () => {
  it("creates backend-safe identifiers for a clinic", () => {
    const session = createTestModeSession("clinic_1", {
      runId: "11111111-1111-4111-8111-111111111111",
      phoneSuffix: "1234567890"
    });

    expect(session).toEqual({
      conversationId: "test:clinic_1:11111111-1111-4111-8111-111111111111",
      patientId: "test_patient:clinic_1:11111111-1111-4111-8111-111111111111",
      whatsappNumber: "+5490001234567890"
    });
  });

  it("rotates identifiers for a new conversation", () => {
    const first = createTestModeSession("clinic_1", {
      runId: "11111111-1111-4111-8111-111111111111",
      phoneSuffix: "1234567890"
    });
    const second = createTestModeSession("clinic_1", {
      runId: "22222222-2222-4222-8222-222222222222",
      phoneSuffix: "9876543210"
    });

    expect(second.conversationId).not.toBe(first.conversationId);
    expect(second.patientId).not.toBe(first.patientId);
    expect(second.whatsappNumber).not.toBe(first.whatsappNumber);
  });
});

describe("test mode chat page source", () => {
  it("sends stable test session identifiers with every message", () => {
    expect(testModePage).toMatch(/createTestModeSession/);
    expect(testModePage).toMatch(/conversationId: session\.conversationId/);
    expect(testModePage).toMatch(/patientId: session\.patientId/);
    expect(testModePage).toMatch(/whatsappNumber: session\.whatsappNumber/);
  });

  it("exposes a chat transcript and new conversation action", () => {
    expect(testModePage).toMatch(/New conversation/);
    expect(testModePage).toMatch(/test-chat-thread/);
    expect(testModePage).toMatch(/Test mode uses live availability and keeps the calendar unchanged\./);
    expect(testModePage).not.toMatch(/Dry-run/);
    expect(globals).toMatch(/\.test-chat-thread/);
    expect(globals).toMatch(/\.test-chat-message/);
  });
});
