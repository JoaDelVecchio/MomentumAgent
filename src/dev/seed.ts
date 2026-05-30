import { InMemoryAuditLog } from "../adapters/memory/audit-log.js";
import { FakeCalendar } from "../adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../adapters/memory/repositories.js";
import { ConversationWorkflow } from "../application/conversations/conversation-workflow.js";
import { SchedulingService } from "../application/scheduling/scheduling-service.js";
import { buildDemoClinicProfile } from "./demo-clinic-profile.js";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPort,
  FindFreeSlotsInput
} from "../ports/calendar.js";
import { CalendarInfrastructureError } from "../ports/calendar.js";

export type CalendarProvider = "fake" | "google";

type BuildDevContainerOptions = {
  now?: Date;
  calendarProvider?: CalendarProvider;
  calendar?: CalendarPort;
};

export function buildDevContainer(options: BuildDevContainerOptions = {}) {
  const now = options.now ?? new Date();
  const repos = new InMemoryRepositories();
  const calendar = options.calendar ?? buildDefaultCalendar(options.calendarProvider);
  const audit = new InMemoryAuditLog();

  repos.upsertClinicProfile(buildDemoClinicProfile());

  const firstSlotStart = atUtcHour(addDays(startOfDay(now), 3), 13, 0);
  const secondSlotStart = atUtcHour(addDays(startOfDay(now), 3), 13, 30);
  if (calendar instanceof FakeCalendar) {
    calendar.seedAvailability("cal_perez", [
      { startsAt: firstSlotStart, endsAt: addMinutes(firstSlotStart, 30) },
      { startsAt: secondSlotStart, endsAt: addMinutes(secondSlotStart, 30) }
    ]);
  }

  const scheduling = new SchedulingService(repos, calendar, audit);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => now);

  return { repos, calendar, audit, scheduling, workflow };
}

class MissingGoogleCalendar implements CalendarPort {
  async findFreeSlots(_input: FindFreeSlotsInput): Promise<never> {
    throw missingGoogleCalendarError();
  }

  async createEvent(_input: CalendarEventInput): Promise<CalendarEvent> {
    throw missingGoogleCalendarError();
  }

  async updateEvent(_eventId: string, _input: CalendarEventInput): Promise<CalendarEvent> {
    throw missingGoogleCalendarError();
  }

  async cancelEvent(_eventId: string, _calendarId?: string): Promise<CalendarEvent> {
    throw missingGoogleCalendarError();
  }

  async getEvent(_eventId: string, _calendarId?: string): Promise<CalendarEvent | undefined> {
    throw missingGoogleCalendarError();
  }
}

export function buildDefaultCalendar(calendarProvider: CalendarProvider = "fake"): CalendarPort {
  return calendarProvider === "google" ? new MissingGoogleCalendar() : new FakeCalendar();
}

function missingGoogleCalendarError() {
  return new CalendarInfrastructureError("Google Calendar provider is selected but not configured");
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function atUtcHour(date: Date, hours: number, minutes: number) {
  const next = new Date(date);
  next.setUTCHours(hours, minutes, 0, 0);
  return next;
}
