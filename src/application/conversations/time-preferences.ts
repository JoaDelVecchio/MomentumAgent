import type { CalendarSlot } from "../../ports/calendar.js";
import type { ConversationUnderstanding } from "./interpreter.js";

export function resolveSlotSearchRange(input: {
  now: Date;
  defaultFrom: Date;
  defaultTo: Date;
  understanding: ConversationUnderstanding;
}) {
  const normalized = input.understanding.normalizedTimePreference;
  const from =
    normalized?.from && normalized.from >= input.defaultFrom && normalized.from <= input.defaultTo
      ? normalized.from
      : input.defaultFrom;
  const to =
    normalized?.to && normalized.to >= input.defaultFrom && normalized.to <= input.defaultTo
      ? normalized.to
      : input.defaultTo;
  return { from, to };
}

export function filterSlotsByDaypart(slots: CalendarSlot[], understanding: ConversationUnderstanding) {
  const daypart = understanding.normalizedTimePreference?.daypart;
  if (!daypart) {
    return slots;
  }

  return slots.filter((slot) => {
    const hour = slot.startsAt.getUTCHours();
    if (daypart === "morning") {
      return hour >= 6 && hour < 12;
    }
    if (daypart === "afternoon") {
      return hour >= 12 && hour < 18;
    }
    return hour >= 18 && hour < 23;
  });
}
