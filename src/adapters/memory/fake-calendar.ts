import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPort,
  CalendarSlot,
  FindFreeSlotsInput
} from "../../ports/calendar.js";

type AvailabilitySeed = {
  startsAt: Date;
  endsAt: Date;
};

export class FakeCalendar implements CalendarPort {
  private availability = new Map<string, AvailabilitySeed[]>();
  private events = new Map<string, CalendarEvent>();
  private eventCounter = 0;

  seedAvailability(calendarId: string, slots: AvailabilitySeed[]) {
    this.availability.set(calendarId, slots.map((slot) => cloneAvailability(slot)));
  }

  async findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]> {
    const results: CalendarSlot[] = [];

    for (const calendarId of input.calendarIds) {
      const available = this.availability.get(calendarId) ?? [];
      const activeEvents = [...this.events.values()].filter(
        (event) => event.calendarId === calendarId && event.status === "scheduled"
      );

      for (const slot of available) {
        const duration = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60000;
        const insideWindow = slot.startsAt >= input.from && slot.endsAt <= input.to;
        const longEnough = duration >= input.durationMinutes;
        const overlaps = activeEvents.some(
          (event) => slot.startsAt < event.endsAt && slot.endsAt > event.startsAt
        );

        if (insideWindow && longEnough && !overlaps) {
          results.push({ calendarId, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt) });
        }
      }
    }

    return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    this.eventCounter += 1;
    const event: CalendarEvent = {
      ...cloneEventInput(input),
      id: `evt_${this.eventCounter}`,
      status: "scheduled"
    };
    this.events.set(event.id, event);
    return cloneEvent(event);
  }

  async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new Error(`Calendar event ${eventId} not found`);
    }

    const updated: CalendarEvent = {
      ...cloneEventInput(input),
      id: eventId,
      status: existing.status
    };
    this.events.set(eventId, updated);
    return cloneEvent(updated);
  }

  async cancelEvent(eventId: string): Promise<CalendarEvent> {
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new Error(`Calendar event ${eventId} not found`);
    }

    const cancelled = { ...existing, status: "cancelled" as const };
    this.events.set(eventId, cancelled);
    return cloneEvent(cancelled);
  }

  async getEvent(eventId: string): Promise<CalendarEvent | undefined> {
    const event = this.events.get(eventId);
    return event ? cloneEvent(event) : undefined;
  }
}

function cloneAvailability(slot: AvailabilitySeed): AvailabilitySeed {
  return {
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt)
  };
}

function cloneEventInput(input: CalendarEventInput): CalendarEventInput {
  return {
    calendarId: input.calendarId,
    summary: input.summary,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    metadata: { ...input.metadata }
  };
}

function cloneEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...cloneEventInput(event),
    id: event.id,
    status: event.status
  };
}
