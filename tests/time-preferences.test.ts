import { describe, expect, it } from "vitest";
import type { ConversationUnderstanding } from "../src/application/conversations/interpreter.js";
import { filterSlotsByDaypart, resolveSlotSearchRange } from "../src/application/conversations/time-preferences.js";

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
  const defaultFrom = new Date("2026-06-01T00:00:00.000Z");
  const defaultTo = new Date("2026-06-15T00:00:00.000Z");

  it("ignores normalized from after defaultTo", () => {
    const range = resolveSlotSearchRange({
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
      defaultFrom,
      defaultTo,
      understanding: understanding({
        normalizedTimePreference: { from: normalizedFrom, to: normalizedTo }
      })
    });

    expect(range).toEqual({ from: normalizedFrom, to: normalizedTo });
  });

  it("falls back to default range for inverted in-window normalized values", () => {
    const range = resolveSlotSearchRange({
      defaultFrom,
      defaultTo,
      understanding: understanding({
        normalizedTimePreference: {
          from: new Date("2026-06-10T00:00:00.000Z"),
          to: new Date("2026-06-03T00:00:00.000Z")
        }
      })
    });

    expect(range).toEqual({ from: defaultFrom, to: defaultTo });
  });
});

describe("filterSlotsByDaypart", () => {
  it("filters afternoon slots using the clinic timezone", () => {
    const localMorningSlot = {
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T12:00:00.000Z"),
      endsAt: new Date("2026-06-01T12:30:00.000Z")
    };
    const localAfternoonSlot = {
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T19:00:00.000Z"),
      endsAt: new Date("2026-06-01T19:30:00.000Z")
    };
    expect(
      filterSlotsByDaypart(
        [localMorningSlot, localAfternoonSlot],
        understanding({ normalizedTimePreference: { daypart: "afternoon" } }),
        "America/Argentina/Buenos_Aires"
      )
    ).toEqual([localAfternoonSlot]);
  });
});
