import type { CalendarSlot } from "../../ports/calendar.js";
import type { ConversationUnderstanding } from "./interpreter.js";
import { normalizeText } from "./intent.js";

export type NormalizedTimePreference = NonNullable<ConversationUnderstanding["normalizedTimePreference"]>;

export function resolveSlotSearchRange(input: {
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
  if (from >= to) {
    return { from: input.defaultFrom, to: input.defaultTo };
  }
  return { from, to };
}

export function filterSlotsByDaypart(slots: CalendarSlot[], understanding: ConversationUnderstanding, timezone: string) {
  const daypart = understanding.normalizedTimePreference?.daypart;
  if (!daypart) {
    return slots;
  }

  const localHourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false
  });

  return slots.filter((slot) => {
    const hour = Number(localHourFormatter.format(slot.startsAt)) % 24;
    if (daypart === "morning") {
      return hour >= 6 && hour < 12;
    }
    if (daypart === "afternoon") {
      return hour >= 12 && hour < 18;
    }
    return hour >= 18 && hour < 23;
  });
}

export function detectNormalizedTimePreference(
  text: string,
  now: Date,
  timezone = "UTC"
): NormalizedTimePreference | null {
  const normalized = normalizeText(text);
  const dateRange = detectDateRange(normalized, now, timezone);
  const daypart = detectDaypart(normalized);
  if (!dateRange && !daypart) {
    return null;
  }

  return {
    ...(dateRange ?? {}),
    ...(daypart ? { daypart } : {})
  };
}

function detectDaypart(normalized: string): "morning" | "afternoon" | "evening" | undefined {
  if (containsAny(normalized, ["tarde", "mediodia"])) {
    return "afternoon";
  }
  if (containsAny(normalized, ["noche", "ultima hora"])) {
    return "evening";
  }
  if (containsAny(normalized, ["a la manana", "por la manana", "temprano"])) {
    return "morning";
  }
  return undefined;
}

function detectDateRange(normalized: string, now: Date, timezone: string) {
  const today = localDateParts(now, timezone);

  if (new RegExp("\\bhoy\\b").test(normalized)) {
    return buildLocalDayRange(today, timezone);
  }

  if (normalized.includes("pasado manana")) {
    return buildRelativeDayRange(today, 2, timezone);
  }

  if (hasRelativeTomorrow(normalized)) {
    return buildRelativeDayRange(today, 1, timezone);
  }

  const weekday = detectWeekday(normalized);
  if (weekday !== undefined) {
    return buildWeekdayRange(today, weekday, timezone);
  }

  const explicitMonth = normalized.match(
    /\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/
  );
  if (explicitMonth) {
    return buildDayRange({
      day: Number(explicitMonth[1]),
      month: monthNumber(explicitMonth[2]),
      year: today.year,
      today,
      timezone,
      rollPastDate: true
    });
  }

  const numeric = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const parsedYear = numeric[3] ? Number(numeric[3]) : today.year;
    return buildDayRange({
      day: Number(numeric[1]),
      month: Number(numeric[2]),
      year: parsedYear < 100 ? 2000 + parsedYear : parsedYear,
      today,
      timezone,
      rollPastDate: !numeric[3]
    });
  }

  const dayOnly = normalized.match(/\b(?:el|dia|para) (\d{1,2})\b/);
  if (dayOnly) {
    return buildDayRange({
      day: Number(dayOnly[1]),
      month: today.month,
      year: today.year,
      today,
      timezone,
      rollPastDate: true,
      rollByMonth: true
    });
  }

  return undefined;
}

function hasRelativeTomorrow(normalized: string) {
  const withoutMorningDaypart = normalized.replace(/\b(?:a|por) la manana\b/g, "");
  return new RegExp("\\bmanana\\b").test(withoutMorningDaypart);
}

function detectWeekday(normalized: string) {
  const weekdays: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6
  };

  for (const [name, day] of Object.entries(weekdays)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) {
      return day;
    }
  }
  return undefined;
}

function buildWeekdayRange(today: LocalDate, targetWeekday: number, timezone: string) {
  const daysAhead = (targetWeekday - dayOfWeek(today) + 7) % 7;
  return buildLocalDayRange(addLocalDays(today, daysAhead), timezone);
}

function buildRelativeDayRange(today: LocalDate, daysFromNow: number, timezone: string) {
  return buildLocalDayRange(addLocalDays(today, daysFromNow), timezone);
}

function buildDayRange(input: {
  day: number;
  month: number;
  year: number;
  today: LocalDate;
  timezone: string;
  rollPastDate: boolean;
  rollByMonth?: boolean;
}) {
  if (input.day < 1 || input.day > 31 || input.month < 1 || input.month > 12) {
    return undefined;
  }

  let localDate: LocalDate = { year: input.year, month: input.month, day: input.day };
  if (!isValidLocalDate(localDate)) {
    return undefined;
  }

  if (input.rollPastDate && compareLocalDate(localDate, input.today) < 0) {
    localDate = input.rollByMonth
      ? normalizeLocalDate({ year: input.year, month: input.month + 1, day: input.day })
      : { year: input.year + 1, month: input.month, day: input.day };
  }
  if (!isValidLocalDate(localDate)) {
    return undefined;
  }

  return buildLocalDayRange(localDate, input.timezone);
}

type LocalDate = {
  year: number;
  month: number;
  day: number;
};

type LocalDateTime = LocalDate & {
  hour: number;
  minute: number;
  second: number;
};

function buildLocalDayRange(localDate: LocalDate, timezone: string) {
  const from = localDateTimeToUtc(localDate, "00:00", timezone);
  const to = localDateTimeToUtc(addLocalDays(localDate, 1), "00:00", timezone);
  return { from, to };
}

function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  const date = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function normalizeLocalDate(localDate: LocalDate): LocalDate {
  return addLocalDays({ year: localDate.year, month: localDate.month, day: localDate.day }, 0);
}

function isValidLocalDate(localDate: LocalDate) {
  const date = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day));
  return (
    date.getUTCFullYear() === localDate.year &&
    date.getUTCMonth() + 1 === localDate.month &&
    date.getUTCDate() === localDate.day
  );
}

function compareLocalDate(first: LocalDate, second: LocalDate) {
  return localDateKey(first).localeCompare(localDateKey(second));
}

function localDateTimeToUtc(localDate: LocalDate, time: string, timezone: string) {
  const { hours, minutes } = parseTime(time);
  const localTimestamp = Date.UTC(localDate.year, localDate.month - 1, localDate.day, hours, minutes, 0, 0);
  let utcTimestamp = localTimestamp - timeZoneOffsetMs(new Date(localTimestamp), timezone);
  utcTimestamp = localTimestamp - timeZoneOffsetMs(new Date(utcTimestamp), timezone);
  return new Date(utcTimestamp);
}

function timeZoneOffsetMs(date: Date, timezone: string) {
  const parts = localDateTimeParts(date, timezone);
  const localTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return localTimestamp - date.getTime();
}

function localDateParts(date: Date, timezone: string): LocalDate {
  const parts = localDateTimeParts(date, timezone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
  };
}

function localDateTimeParts(date: Date, timezone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function parseTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return { hours, minutes };
}

function dayOfWeek(localDate: LocalDate) {
  return new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay();
}

function localDateKey(localDate: LocalDate) {
  return `${localDate.year}-${String(localDate.month).padStart(2, "0")}-${String(localDate.day).padStart(2, "0")}`;
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function monthNumber(month: string) {
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };
  return months[month] ?? -1;
}
