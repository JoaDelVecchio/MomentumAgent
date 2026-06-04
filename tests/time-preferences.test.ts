import { describe, expect, it } from "vitest";
import type { ConversationUnderstanding } from "../src/application/conversations/interpreter.js";
import {
  detectNormalizedTimePreference,
  filterSlotsByDaypart,
  resolveSlotSearchRange
} from "../src/application/conversations/time-preferences.js";

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

describe("detectNormalizedTimePreference", () => {
  it("normalizes weekday requests to the next matching local day", () => {
    expect(detectNormalizedTimePreference("quiero turno para el martes", new Date("2026-06-04T12:00:00.000Z"))).toEqual({
      from: new Date("2026-06-09T00:00:00.000Z"),
      to: new Date("2026-06-10T00:00:00.000Z")
    });
  });

  it("uses the clinic timezone for local day boundaries", () => {
    expect(
      detectNormalizedTimePreference(
        "quiero turno para el martes",
        new Date("2026-06-04T12:00:00.000Z"),
        "America/Argentina/Buenos_Aires"
      )
    ).toEqual({
      from: new Date("2026-06-09T03:00:00.000Z"),
      to: new Date("2026-06-10T03:00:00.000Z")
    });
  });

  it("keeps daypart when normalizing weekday requests", () => {
    expect(
      detectNormalizedTimePreference(
        "martes a la tarde",
        new Date("2026-06-04T12:00:00.000Z"),
        "America/Argentina/Buenos_Aires"
      )
    ).toEqual({
      from: new Date("2026-06-09T03:00:00.000Z"),
      to: new Date("2026-06-10T03:00:00.000Z"),
      daypart: "afternoon"
    });
  });

  it("distinguishes tomorrow morning from a generic morning daypart", () => {
    expect(
      detectNormalizedTimePreference(
        "manana a la manana",
        new Date("2026-06-04T12:00:00.000Z"),
        "America/Argentina/Buenos_Aires"
      )
    ).toEqual({
      from: new Date("2026-06-05T03:00:00.000Z"),
      to: new Date("2026-06-06T03:00:00.000Z"),
      daypart: "morning"
    });
  });

  it("normalizes today in the clinic timezone", () => {
    expect(
      detectNormalizedTimePreference(
        "tenes algo hoy a la tarde",
        new Date("2026-06-04T12:00:00.000Z"),
        "America/Argentina/Buenos_Aires"
      )
    ).toEqual({
      from: new Date("2026-06-04T03:00:00.000Z"),
      to: new Date("2026-06-05T03:00:00.000Z"),
      daypart: "afternoon"
    });
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
