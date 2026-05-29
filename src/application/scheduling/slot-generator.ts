import type { Professional, TimeSlot } from "../../domain/types.js";
import type { CalendarSlot } from "../../ports/calendar.js";

export type GenerateWorkingHourSlotsInput = {
  timezone: string;
  professionals: Pick<Professional, "id" | "calendarId" | "workingHours">[];
  from: Date;
  to: Date;
  serviceDurationMinutes: number;
  bufferMinutes: number;
  busyIntervals: CalendarSlot[];
};

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

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;

export function generateWorkingHourSlots(input: GenerateWorkingHourSlotsInput): TimeSlot[] {
  if (input.to <= input.from || input.serviceDurationMinutes <= 0) {
    return [];
  }

  const serviceDurationMs = input.serviceDurationMinutes * minuteMs;
  const requiredFreeDurationMs = (input.serviceDurationMinutes + input.bufferMinutes) * minuteMs;
  const busyByCalendarId = groupBusyIntervals(input.busyIntervals);
  const localDates = listLocalDates(input.from, input.to, input.timezone);
  const slots: TimeSlot[] = [];

  for (const professional of input.professionals) {
    for (const localDate of localDates) {
      const localDay = dayOfWeek(localDate);
      const workingWindows = professional.workingHours.filter((workingWindow) => workingWindow.day === localDay);

      for (const workingWindow of workingWindows) {
        const windowStartsAt = localDateTimeToUtc(localDate, workingWindow.startTime, input.timezone);
        const windowEndsAt = localDateTimeToUtc(localDate, workingWindow.endTime, input.timezone);
        let candidateStartsAt = new Date(windowStartsAt);

        while (candidateStartsAt.getTime() + requiredFreeDurationMs <= windowEndsAt.getTime()) {
          const requiredEndsAt = new Date(candidateStartsAt.getTime() + requiredFreeDurationMs);
          const appointmentEndsAt = new Date(candidateStartsAt.getTime() + serviceDurationMs);

          if (
            candidateStartsAt >= input.from &&
            requiredEndsAt <= input.to &&
            !overlapsBusyInterval(
              candidateStartsAt,
              requiredEndsAt,
              busyByCalendarId.get(professional.calendarId) ?? []
            )
          ) {
            slots.push({
              professionalId: professional.id,
              calendarId: professional.calendarId,
              startsAt: new Date(candidateStartsAt),
              endsAt: appointmentEndsAt
            });
          }

          candidateStartsAt = new Date(candidateStartsAt.getTime() + serviceDurationMs);
        }
      }
    }
  }

  return slots.sort((first, second) => {
    const byStart = first.startsAt.getTime() - second.startsAt.getTime();
    if (byStart !== 0) {
      return byStart;
    }

    return first.professionalId.localeCompare(second.professionalId);
  });
}

function groupBusyIntervals(busyIntervals: CalendarSlot[]) {
  const busyByCalendarId = new Map<string, CalendarSlot[]>();
  for (const busyInterval of busyIntervals) {
    const intervals = busyByCalendarId.get(busyInterval.calendarId) ?? [];
    intervals.push({
      calendarId: busyInterval.calendarId,
      startsAt: new Date(busyInterval.startsAt),
      endsAt: new Date(busyInterval.endsAt)
    });
    busyByCalendarId.set(busyInterval.calendarId, intervals);
  }
  return busyByCalendarId;
}

function listLocalDates(from: Date, to: Date, timezone: string): LocalDate[] {
  const datesByKey = new Map<string, LocalDate>();
  const startsAt = startOfUtcDay(new Date(from.getTime() - dayMs));
  const endsAt = startOfUtcDay(new Date(to.getTime() + dayMs));

  for (let time = startsAt.getTime(); time <= endsAt.getTime(); time += dayMs) {
    const localDate = localDateParts(new Date(time), timezone);
    datesByKey.set(localDateKey(localDate), localDate);
  }

  return [...datesByKey.values()].sort((first, second) => localDateKey(first).localeCompare(localDateKey(second)));
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

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function overlapsBusyInterval(startsAt: Date, endsAt: Date, busyIntervals: CalendarSlot[]) {
  return busyIntervals.some((busyInterval) => startsAt < busyInterval.endsAt && endsAt > busyInterval.startsAt);
}
