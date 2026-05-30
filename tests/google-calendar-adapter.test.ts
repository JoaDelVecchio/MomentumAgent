import { describe, expect, it } from "vitest";
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import { GoogleCalendarAdapter } from "../src/adapters/google/google-calendar-adapter.js";
import {
  GoogleCalendarApiClient,
  GoogleCalendarFreeBusyError,
  type GoogleAuthClient,
  type GoogleCalendarApi,
  type GoogleCalendarClient,
  type GoogleCalendarEventResource,
  type GoogleCalendarEventWriteInput
} from "../src/adapters/google/google-calendar-client.js";
import { GOOGLE_CALENDAR_SCOPES } from "../src/config/google-calendar.js";
import { CalendarAvailabilityError } from "../src/ports/calendar.js";

describe("GoogleCalendarApiClient", () => {
  const config = {
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    redirectUri: "http://localhost:3000/integrations/google-calendar/callback",
    stateSecret: "google-state-secret",
    setupToken: "google-setup-token",
    scopes: [...GOOGLE_CALENDAR_SCOPES]
  };

  it("throws when FreeBusy returns per-calendar errors", async () => {
    const repository = new InMemoryCalendarCredentialRepository();
    await repository.save({
      clinicId: "clinic_google_client",
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "old_access_token",
      refreshToken: "refresh_token"
    });
    const api = new FakeGoogleCalendarApi();
    api.freeBusyCalendars = {
      cal_perez: {
        errors: [{ reason: "notFound" }]
      }
    };
    const client = new GoogleCalendarApiClient({
      clinicId: "clinic_google_client",
      credentialRepository: repository,
      config,
      authClient: new FakeAuthClient(),
      calendarApi: api
    });

    await expect(
      client.queryFreeBusy(
        ["cal_perez"],
        new Date("2026-06-01T12:00:00.000Z"),
        new Date("2026-06-01T14:00:00.000Z")
      )
    ).rejects.toThrow(GoogleCalendarFreeBusyError);
  });

  it("throws when FreeBusy omits a requested calendar entry", async () => {
    const repository = new InMemoryCalendarCredentialRepository();
    await repository.save({
      clinicId: "clinic_google_client",
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "old_access_token",
      refreshToken: "refresh_token"
    });
    const client = new GoogleCalendarApiClient({
      clinicId: "clinic_google_client",
      credentialRepository: repository,
      config,
      authClient: new FakeAuthClient(),
      calendarApi: new FakeGoogleCalendarApi()
    });

    await expect(
      client.queryFreeBusy(
        ["cal_missing"],
        new Date("2026-06-01T12:00:00.000Z"),
        new Date("2026-06-01T14:00:00.000Z")
      )
    ).rejects.toThrow(GoogleCalendarFreeBusyError);
  });

  it("patches Google events instead of replacing the full event resource", async () => {
    const repository = new InMemoryCalendarCredentialRepository();
    await repository.save({
      clinicId: "clinic_google_client",
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "old_access_token",
      refreshToken: "refresh_token"
    });
    const api = new FakeGoogleCalendarApi();
    api.patchResult = apiEvent({
      id: "google_evt_1",
      startsAt: "2026-06-01T13:00:00.000Z",
      endsAt: "2026-06-01T13:30:00.000Z"
    });
    const client = new GoogleCalendarApiClient({
      clinicId: "clinic_google_client",
      credentialRepository: repository,
      config,
      authClient: new FakeAuthClient(),
      calendarApi: api
    });

    await client.updateEvent("cal_perez", "google_evt_1", {
      summary: "Updated",
      start: { dateTime: "2026-06-01T13:00:00.000Z", timeZone: "America/Argentina/Buenos_Aires" },
      end: { dateTime: "2026-06-01T13:30:00.000Z", timeZone: "America/Argentina/Buenos_Aires" },
      extendedProperties: { private: { appointmentId: "appt_1" } }
    });

    expect(api.patchCalls).toEqual([
      {
        calendarId: "cal_perez",
        eventId: "google_evt_1",
        requestBody: {
          summary: "Updated",
          start: { dateTime: "2026-06-01T13:00:00.000Z", timeZone: "America/Argentina/Buenos_Aires" },
          end: { dateTime: "2026-06-01T13:30:00.000Z", timeZone: "America/Argentina/Buenos_Aires" },
          extendedProperties: { private: { appointmentId: "appt_1" } }
        }
      }
    ]);
  });
});

describe("GoogleCalendarAdapter", () => {
  const timezone = "America/Argentina/Buenos_Aires";

  it("queries FreeBusy for all requested calendars and removes busy working-hour slots", async () => {
    const client = new FakeGoogleCalendarClient();
    client.freeBusyResult = [
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T12:30:00.000Z"),
        endsAt: new Date("2026-06-01T13:00:00.000Z")
      }
    ];
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    const slots = await adapter.findFreeSlots({
      calendarIds: ["cal_perez", "cal_lopez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T14:00:00.000Z"),
      durationMinutes: 30,
      availabilityContext: {
        timezone,
        professionals: [
          {
            id: "pro_perez",
            calendarId: "cal_perez",
            workingHours: [{ day: 1, startTime: "09:00", endTime: "11:00" }]
          }
        ],
        serviceDurationMinutes: 30,
        bufferMinutes: 0
      }
    });

    expect(client.freeBusyCalls).toEqual([
      {
        calendarIds: ["cal_perez", "cal_lopez"],
        from: new Date("2026-06-01T12:00:00.000Z"),
        to: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
    expect(slots).toEqual([
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T12:00:00.000Z"),
        endsAt: new Date("2026-06-01T12:30:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("checks availability before inserting an event and writes Google event fields", async () => {
    const client = new FakeGoogleCalendarClient();
    client.listEventsResults.push([], [
      googleEvent({
        id: "google_evt_1",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      })
    ]);
    client.insertEventResult = googleEvent({
      id: "google_evt_1",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    });
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    const event = await adapter.createEvent({
      calendarId: "cal_perez",
      summary: "Botox - pat_1",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: {
        appointmentId: "appt_1",
        patientId: "pat_1",
        serviceId: "svc_botox"
      }
    });

    expect(client.operations).toEqual([
      "listEvents:cal_perez:2026-06-01T13:00:00.000Z:2026-06-01T13:30:00.000Z",
      "insertEvent:cal_perez",
      "listEvents:cal_perez:2026-06-01T13:00:00.000Z:2026-06-01T13:30:00.000Z"
    ]);
    expect(client.insertEventCalls[0]).toEqual({
      calendarId: "cal_perez",
      event: {
        summary: "Botox - pat_1",
        start: {
          dateTime: "2026-06-01T13:00:00.000Z",
          timeZone: timezone
        },
        end: {
          dateTime: "2026-06-01T13:30:00.000Z",
          timeZone: timezone
        },
        extendedProperties: {
          private: {
            appointmentId: "appt_1",
            patientId: "pat_1",
            serviceId: "svc_botox"
          }
        }
      }
    });
    expect(event).toMatchObject({
      id: "google_evt_1",
      calendarId: "cal_perez",
      status: "scheduled"
    });
  });

  it("deletes an inserted event and throws when post-create overlap check detects a conflict", async () => {
    const client = new FakeGoogleCalendarClient();
    client.listEventsResults.push([], [
      googleEvent({
        id: "google_evt_inserted",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      }),
      googleEvent({
        id: "google_evt_race",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:15:00.000Z"),
        endsAt: new Date("2026-06-01T13:45:00.000Z")
      })
    ]);
    client.insertEventResult = googleEvent({
      id: "google_evt_inserted",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    });
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    await expect(
      adapter.createEvent({
        calendarId: "cal_perez",
        summary: "Botox - pat_1",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z"),
        metadata: { appointmentId: "appt_1" }
      })
    ).rejects.toThrow(CalendarAvailabilityError);

    expect(client.deleteEventCalls).toEqual([
      { calendarId: "cal_perez", eventId: "google_evt_inserted" }
    ]);
  });

  it("checks replacement availability before updating the Google event", async () => {
    const client = new FakeGoogleCalendarClient();
    client.getEventResult = googleEvent({
      id: "google_evt_1",
      calendarId: "cal_perez",
      summary: "Original",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_1" }
    });
    client.listEventsResults.push([], [
      googleEvent({
        id: "google_evt_1",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z")
      })
    ]);
    client.updateEventResult = googleEvent({
      id: "google_evt_1",
      calendarId: "cal_perez",
      summary: "Updated",
      startsAt: new Date("2026-06-01T14:00:00.000Z"),
      endsAt: new Date("2026-06-01T14:30:00.000Z"),
      metadata: { appointmentId: "appt_1" }
    });
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    const event = await adapter.updateEvent("google_evt_1", {
      calendarId: "cal_perez",
      summary: "Updated",
      startsAt: new Date("2026-06-01T14:00:00.000Z"),
      endsAt: new Date("2026-06-01T14:30:00.000Z"),
      metadata: { appointmentId: "appt_1" }
    });

    expect(client.operations).toEqual([
      "getEvent:cal_perez:google_evt_1",
      "listEvents:cal_perez:2026-06-01T14:00:00.000Z:2026-06-01T14:30:00.000Z",
      "updateEvent:cal_perez:google_evt_1",
      "listEvents:cal_perez:2026-06-01T14:00:00.000Z:2026-06-01T14:30:00.000Z"
    ]);
    expect(event).toMatchObject({
      id: "google_evt_1",
      calendarId: "cal_perez",
      status: "scheduled",
      summary: "Updated"
    });
  });

  it("rolls an updated event back and throws when post-update overlap check detects a conflict", async () => {
    const client = new FakeGoogleCalendarClient();
    client.getEventResult = googleEvent({
      id: "google_evt_1",
      calendarId: "cal_perez",
      summary: "Original",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_1" }
    });
    client.listEventsResults.push([], [
      googleEvent({
        id: "google_evt_1",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z")
      }),
      googleEvent({
        id: "google_evt_race",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:15:00.000Z"),
        endsAt: new Date("2026-06-01T14:45:00.000Z")
      })
    ]);
    client.updateEventResult = googleEvent({
      id: "google_evt_1",
      calendarId: "cal_perez",
      summary: "Updated",
      startsAt: new Date("2026-06-01T14:00:00.000Z"),
      endsAt: new Date("2026-06-01T14:30:00.000Z"),
      metadata: { appointmentId: "appt_1" }
    });
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    await expect(
      adapter.updateEvent("google_evt_1", {
        calendarId: "cal_perez",
        summary: "Updated",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z"),
        metadata: { appointmentId: "appt_1" }
      })
    ).rejects.toThrow(CalendarAvailabilityError);

    expect(client.updateEventCalls).toHaveLength(2);
    expect(client.updateEventCalls[1]).toEqual({
      calendarId: "cal_perez",
      eventId: "google_evt_1",
      event: {
        summary: "Original",
        start: {
          dateTime: "2026-06-01T13:00:00.000Z",
          timeZone: timezone
        },
        end: {
          dateTime: "2026-06-01T13:30:00.000Z",
          timeZone: timezone
        },
        extendedProperties: {
          private: { appointmentId: "appt_1" }
        }
      }
    });
  });

  it("cancels by deleting the Google event and treats 404 as already cancelled", async () => {
    const client = new FakeGoogleCalendarClient();
    const adapter = new GoogleCalendarAdapter(client, { timezone });

    await expect(adapter.cancelEvent("google_evt_missing", "cal_perez")).resolves.toMatchObject({
      id: "google_evt_missing",
      calendarId: "cal_perez",
      status: "cancelled"
    });
    client.deleteError = Object.assign(new Error("Not found"), { status: 404 });
    await expect(adapter.cancelEvent("google_evt_deleted", "cal_perez")).resolves.toMatchObject({
      id: "google_evt_deleted",
      calendarId: "cal_perez",
      status: "cancelled"
    });

    expect(client.deleteEventCalls).toEqual([
      { calendarId: "cal_perez", eventId: "google_evt_missing" },
      { calendarId: "cal_perez", eventId: "google_evt_deleted" }
    ]);
  });
});

class FakeGoogleCalendarClient implements GoogleCalendarClient {
  freeBusyResult: Array<{ calendarId: string; startsAt: Date; endsAt: Date }> = [];
  listEventsResults: GoogleCalendarEventResource[][] = [];
  insertEventResult: GoogleCalendarEventResource = googleEvent({
    id: "google_evt_default",
    calendarId: "cal_default",
    startsAt: new Date("2026-06-01T13:00:00.000Z"),
    endsAt: new Date("2026-06-01T13:30:00.000Z")
  });
  updateEventResult: GoogleCalendarEventResource = this.insertEventResult;
  getEventResult?: GoogleCalendarEventResource;
  deleteError?: unknown;
  readonly operations: string[] = [];
  readonly freeBusyCalls: Array<{ calendarIds: string[]; from: Date; to: Date }> = [];
  readonly insertEventCalls: Array<{ calendarId: string; event: GoogleCalendarEventWriteInput }> = [];
  readonly updateEventCalls: Array<{ calendarId: string; eventId: string; event: GoogleCalendarEventWriteInput }> = [];
  readonly deleteEventCalls: Array<{ calendarId: string; eventId: string }> = [];

  async queryFreeBusy(calendarIds: string[], from: Date, to: Date) {
    this.freeBusyCalls.push({ calendarIds, from, to });
    return this.freeBusyResult;
  }

  async listEvents(calendarId: string, from: Date, to: Date) {
    this.operations.push(
      `listEvents:${calendarId}:${from.toISOString()}:${to.toISOString()}`
    );
    return this.listEventsResults.shift() ?? [];
  }

  async insertEvent(calendarId: string, event: GoogleCalendarEventWriteInput) {
    this.operations.push(`insertEvent:${calendarId}`);
    this.insertEventCalls.push({ calendarId, event });
    return this.insertEventResult;
  }

  async updateEvent(calendarId: string, eventId: string, event: GoogleCalendarEventWriteInput) {
    this.operations.push(`updateEvent:${calendarId}:${eventId}`);
    this.updateEventCalls.push({ calendarId, eventId, event });
    return this.updateEventResult;
  }

  async getEvent(calendarId: string, eventId: string) {
    this.operations.push(`getEvent:${calendarId}:${eventId}`);
    return this.getEventResult;
  }

  async deleteEvent(calendarId: string, eventId: string) {
    this.operations.push(`deleteEvent:${calendarId}:${eventId}`);
    this.deleteEventCalls.push({ calendarId, eventId });
    if (this.deleteError) {
      throw this.deleteError;
    }
  }
}

class FakeAuthClient implements GoogleAuthClient {
  credentials: GoogleAuthClient["credentials"] = {};

  setCredentials(credentials: NonNullable<GoogleAuthClient["credentials"]>) {
    this.credentials = { ...credentials };
  }

  async getAccessToken() {
    this.credentials = {
      ...this.credentials,
      access_token: "refreshed_access_token",
      expiry_date: Date.parse("2026-06-01T12:00:00.000Z")
    };
    return { token: "refreshed_access_token" };
  }
}

class FakeGoogleCalendarApi implements GoogleCalendarApi {
  freeBusyCalendars: Awaited<ReturnType<GoogleCalendarApi["freebusy"]["query"]>>["data"]["calendars"] = {};
  patchResult = apiEvent({
    id: "google_evt_default",
    startsAt: "2026-06-01T13:00:00.000Z",
    endsAt: "2026-06-01T13:30:00.000Z"
  });
  readonly patchCalls: Array<{
    calendarId: string;
    eventId: string;
    requestBody: GoogleCalendarEventWriteInput;
  }> = [];

  freebusy = {
    query: async () => ({
      data: {
        calendars: this.freeBusyCalendars
      }
    })
  };

  events = {
    list: async () => ({ data: { items: [] } }),
    insert: async () => ({ data: this.patchResult }),
    patch: async (input: {
      calendarId: string;
      eventId: string;
      requestBody: GoogleCalendarEventWriteInput;
    }) => {
      this.patchCalls.push(input);
      return { data: this.patchResult };
    },
    get: async () => ({ data: this.patchResult }),
    delete: async () => ({ data: {} })
  };
}

function googleEvent(input: {
  id: string;
  calendarId: string;
  summary?: string;
  startsAt: Date;
  endsAt: Date;
  metadata?: Record<string, string>;
  status?: "confirmed" | "cancelled";
}): GoogleCalendarEventResource {
  return {
    id: input.id,
    calendarId: input.calendarId,
    summary: input.summary ?? "Google event",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    metadata: input.metadata ?? {},
    status: input.status ?? "confirmed"
  };
}

function apiEvent(input: {
  id: string;
  summary?: string;
  startsAt: string;
  endsAt: string;
  metadata?: Record<string, string>;
}) {
  return {
    id: input.id,
    summary: input.summary,
    status: "confirmed",
    start: { dateTime: input.startsAt },
    end: { dateTime: input.endsAt },
    extendedProperties: { private: input.metadata ?? {} }
  };
}
