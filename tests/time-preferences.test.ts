import { describe, expect, it } from "vitest";
import type { ConversationUnderstanding } from "../src/application/conversations/interpreter.js";
import { resolveSlotSearchRange } from "../src/application/conversations/time-preferences.js";

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "book",
    confidence: 0.91,
    requestedTopics: [],
    requiresHuman: false,
    reason: "fake",
    ...input
  };
}

describe("resolveSlotSearchRange", () => {
  const now = new Date("2026-05-29T12:00:00.000Z");
  const defaultFrom = new Date("2026-06-01T00:00:00.000Z");
  const defaultTo = new Date("2026-06-15T00:00:00.000Z");

  it("ignores normalized from after defaultTo", () => {
    const range = resolveSlotSearchRange({
      now,
      defaultFrom,
      defaultTo,
      understanding: understanding({
        normalizedTimePreference: { from: new Date("2026-06-16T00:00:00.000Z") }
      })
    });

    expect(range).toEqual({ from: defaultFrom, to: defaultTo });
  });

  it("ignores normalized to before defaultFrom", () => {
    const range = resolveSlotSearchRange({
      now,
      defaultFrom,
      defaultTo,
      understanding: understanding({
        normalizedTimePreference: { to: new Date("2026-05-31T23:59:59.000Z") }
      })
    });

    expect(range).toEqual({ from: defaultFrom, to: defaultTo });
  });

  it("uses normalized values inside the default window", () => {
    const normalizedFrom = new Date("2026-06-03T00:00:00.000Z");
    const normalizedTo = new Date("2026-06-10T00:00:00.000Z");

    const range = resolveSlotSearchRange({
      now,
      defaultFrom,
      defaultTo,
      understanding: understanding({
        normalizedTimePreference: { from: normalizedFrom, to: normalizedTo }
      })
    });

    expect(range).toEqual({ from: normalizedFrom, to: normalizedTo });
  });
});
