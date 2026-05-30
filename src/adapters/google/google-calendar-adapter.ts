import { generateWorkingHourSlots } from "../../application/scheduling/slot-generator.js";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPort,
  FindFreeSlotsInput
} from "../../ports/calendar.js";
import { CalendarAvailabilityError } from "../../ports/calendar.js";
import type {
  GoogleCalendarClient,
  GoogleCalendarEventResource,
  GoogleCalendarEventWriteInput
} from "./google-calendar-client.js";

export type {
  GoogleCalendarClient,
  GoogleCalendarEventResource,
  GoogleCalendarEventWriteInput
} from "./google-calendar-client.js";

type GoogleCalendarAdapterOptions = {
  timezone: string;
};

export class GoogleCalendarAdapter implements CalendarPort {
  constructor(
    private readonly client: GoogleCalendarClient,
    private readonly options: GoogleCalendarAdapterOptions
  ) {}

  async findFreeSlots(input: FindFreeSlotsInput) {
    const busyIntervals = input.ignoredEventId
      ? await this.listBusyIntervals(input)
      : await this.client.queryFreeBusy(input.calendarIds, input.from, input.to);

    return generateWorkingHourSlots({
      timezone: input.availabilityContext.timezone,
      professionals: input.availabilityContext.professionals.filter((professional) =>
        input.calendarIds.includes(professional.calendarId)
      ),
      from: input.from,
      to: input.to,
      serviceDurationMinutes: input.availabilityContext.serviceDurationMinutes,
      bufferMinutes: input.availabilityContext.bufferMinutes,
      busyIntervals
    });
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    await this.assertAvailable(input.calendarId, input.startsAt, input.endsAt);

    let event: GoogleCalendarEventResource;
    try {
      event = await this.client.insertEvent(input.calendarId, this.toGoogleEvent(input));
    } catch (error) {
      throw this.toCalendarError(error);
    }

    try {
      await this.assertAvailable(input.calendarId, input.startsAt, input.endsAt, event.id);
    } catch (error) {
      await this.client.deleteEvent(input.calendarId, event.id);
      throw error;
    }

    return this.toCalendarEvent(event, input);
  }

  async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    const previousEvent = await this.client.getEvent(input.calendarId, eventId);
    await this.assertAvailable(input.calendarId, input.startsAt, input.endsAt, eventId);
    let event: GoogleCalendarEventResource;
    try {
      event = await this.client.updateEvent(
        input.calendarId,
        eventId,
        this.toGoogleEvent(input)
      );
    } catch (error) {
      throw this.toCalendarError(error);
    }

    try {
      await this.assertAvailable(input.calendarId, input.startsAt, input.endsAt, eventId);
    } catch (error) {
      if (previousEvent) {
        await this.client.updateEvent(
          input.calendarId,
          eventId,
          this.toGoogleEvent(previousEvent)
        );
      }
      throw error;
    }

    return this.toCalendarEvent(event, input);
  }

  async cancelEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    if (!calendarId) {
      throw new Error("calendarId is required to cancel a Google Calendar event");
    }

    try {
      await this.client.deleteEvent(calendarId, eventId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    return {
      id: eventId,
      calendarId,
      summary: "",
      startsAt: new Date(0),
      endsAt: new Date(0),
      metadata: {},
      status: "cancelled"
    };
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent | undefined> {
    if (!calendarId) {
      throw new Error("calendarId is required to get a Google Calendar event");
    }
    const event = await this.client.getEvent(calendarId, eventId);
    return event ? this.toCalendarEvent(event) : undefined;
  }

  private async listBusyIntervals(input: FindFreeSlotsInput) {
    const busyIntervals = [];
    for (const calendarId of input.calendarIds) {
      const events = await this.client.listEvents(calendarId, input.from, input.to);
      for (const event of events) {
        if (event.id !== input.ignoredEventId && event.status !== "cancelled") {
          busyIntervals.push({
            calendarId,
            startsAt: event.startsAt,
            endsAt: event.endsAt
          });
        }
      }
    }
    return busyIntervals;
  }

  private async assertAvailable(
    calendarId: string,
    startsAt: Date,
    endsAt: Date,
    ignoredEventId?: string
  ) {
    const events = await this.client.listEvents(calendarId, startsAt, endsAt);
    const overlaps = events.some(
      (event) =>
        event.id !== ignoredEventId &&
        event.status !== "cancelled" &&
        startsAt < event.endsAt &&
        endsAt > event.startsAt
    );
    if (overlaps) {
      throw new CalendarAvailabilityError("Google Calendar event overlaps an existing event");
    }
  }

  private toGoogleEvent(input: CalendarEventInput): GoogleCalendarEventWriteInput {
    return {
      summary: input.summary,
      start: {
        dateTime: input.startsAt.toISOString(),
        timeZone: this.options.timezone
      },
      end: {
        dateTime: input.endsAt.toISOString(),
        timeZone: this.options.timezone
      },
      extendedProperties: {
        private: { ...input.metadata }
      }
    };
  }

  private toCalendarEvent(
    event: GoogleCalendarEventResource,
    fallback?: CalendarEventInput
  ): CalendarEvent {
    return {
      id: event.id,
      calendarId: event.calendarId,
      summary: event.summary || fallback?.summary || "",
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
      metadata: { ...event.metadata },
      status: event.status === "cancelled" ? "cancelled" : "scheduled"
    };
  }

  private toCalendarError(error: unknown) {
    if (isConflictError(error)) {
      return new CalendarAvailabilityError("Google Calendar event conflicts with availability");
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}

function isConflictError(error: unknown) {
  return isGoogleStatusError(error, 409);
}

function isNotFoundError(error: unknown) {
  return isGoogleStatusError(error, 404);
}

function isGoogleStatusError(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}
