import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPort,
  CalendarSlot,
  FindFreeSlotsInput
} from "../../ports/calendar.js";
import { CalendarAvailabilityError } from "../../ports/calendar.js";

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
        (event) =>
          event.id !== input.ignoredEventId &&
          event.calendarId === calendarId &&
          event.status === "scheduled"
      );

      for (const slot of available) {
        const candidates = buildCandidateSlots(slot, input.from, input.to, input.durationMinutes);
        for (const candidate of candidates) {
          const overlaps = activeEvents.some(
            (event) => candidate.startsAt < event.endsAt && candidate.endsAt > event.startsAt
          );

          if (!overlaps) {
            results.push({ calendarId, startsAt: candidate.startsAt, endsAt: candidate.endsAt });
          }
        }
      }
    }

    return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    this.assertEventIsAvailable(input);
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
    if (existing.status === "cancelled") {
      throw new CalendarAvailabilityError("Calendar event is cancelled");
    }
    this.assertEventIsAvailable(input, eventId);

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

  private assertEventIsAvailable(input: CalendarEventInput, ignoredEventId?: string) {
    const available = this.availability.get(input.calendarId) ?? [];
    const insideAvailability = available.some(
      (slot) => input.startsAt >= slot.startsAt && input.endsAt <= slot.endsAt
    );
    if (!insideAvailability) {
      throw new CalendarAvailabilityError("Calendar event is outside available slots");
    }

    const activeEvents = [...this.events.values()].filter(
      (event) => event.id !== ignoredEventId && event.calendarId === input.calendarId && event.status === "scheduled"
    );
    const overlaps = activeEvents.some((event) => input.startsAt < event.endsAt && input.endsAt > event.startsAt);
    if (overlaps) {
      throw new CalendarAvailabilityError("Calendar event overlaps an existing event");
    }
  }
}

function buildCandidateSlots(
  slot: AvailabilitySeed,
  from: Date,
  to: Date,
  durationMinutes: number
): AvailabilitySeed[] {
  const candidates: AvailabilitySeed[] = [];
  const durationMs = durationMinutes * 60000;
  let startsAt = new Date(slot.startsAt);

  while (startsAt.getTime() + durationMs <= slot.endsAt.getTime()) {
    const endsAt = new Date(startsAt.getTime() + durationMs);
    if (startsAt >= from && endsAt <= to) {
      candidates.push({ startsAt: new Date(startsAt), endsAt });
    }
    startsAt = new Date(startsAt.getTime() + durationMs);
  }

  return candidates;
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
