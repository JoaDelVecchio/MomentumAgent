import type { WorkingWindow } from "../domain/types.js";

export type CalendarSlot = {
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
};

export type CalendarAvailabilityProfessional = {
  id: string;
  calendarId: string;
  workingHours: WorkingWindow[];
};

export type CalendarAvailabilityContext = {
  timezone: string;
  professionals: CalendarAvailabilityProfessional[];
  serviceDurationMinutes: number;
  bufferMinutes: number;
};

export type CalendarEventInput = {
  calendarId: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  metadata: Record<string, string>;
};

export type CalendarEvent = CalendarEventInput & {
  id: string;
  status: "scheduled" | "cancelled";
};

export type FindFreeSlotsInput = {
  calendarIds: string[];
  from: Date;
  to: Date;
  durationMinutes: number;
  availabilityContext: CalendarAvailabilityContext;
  ignoredEventId?: string;
};

export class CalendarAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarAvailabilityError";
  }
}

export class CalendarInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarInfrastructureError";
  }
}

export interface CalendarPort {
  findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  cancelEvent(eventId: string, calendarId?: string): Promise<CalendarEvent>;
  getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent | undefined>;
}
