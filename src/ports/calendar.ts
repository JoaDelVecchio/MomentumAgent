export type CalendarSlot = {
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
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
  ignoredEventId?: string;
};

export class CalendarAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarAvailabilityError";
  }
}

export interface CalendarPort {
  findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  cancelEvent(eventId: string): Promise<CalendarEvent>;
  getEvent(eventId: string): Promise<CalendarEvent | undefined>;
}
