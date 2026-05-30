import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { GoogleCalendarConfig } from "../../config/google-calendar.js";
import type { CalendarCredentialRepository } from "../../ports/calendar-auth.js";
import { CalendarInfrastructureError } from "../../ports/calendar.js";

export class GoogleCalendarFreeBusyError extends CalendarInfrastructureError {
  constructor(calendarId: string) {
    super(`Google Calendar FreeBusy failed for calendar ${calendarId}`);
    this.name = "GoogleCalendarFreeBusyError";
  }
}

export type GoogleCalendarBusyInterval = {
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
};

export type GoogleCalendarEventResource = {
  id: string;
  calendarId: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  metadata: Record<string, string>;
  status: "confirmed" | "cancelled";
};

export type GoogleCalendarEventWriteInput = {
  summary: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  extendedProperties: {
    private: Record<string, string>;
  };
};

export interface GoogleCalendarClient {
  queryFreeBusy(
    calendarIds: string[],
    from: Date,
    to: Date
  ): Promise<GoogleCalendarBusyInterval[]>;
  listEvents(calendarId: string, from: Date, to: Date): Promise<GoogleCalendarEventResource[]>;
  insertEvent(
    calendarId: string,
    event: GoogleCalendarEventWriteInput
  ): Promise<GoogleCalendarEventResource>;
  updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEventWriteInput
  ): Promise<GoogleCalendarEventResource>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEventResource | undefined>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export type GoogleAuthClient = {
  credentials?: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  };
  setCredentials(credentials: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
  }): void;
  getAccessToken(): Promise<unknown>;
};

export type GoogleCalendarApi = {
  freebusy: {
    query(input: {
      requestBody: {
        timeMin: string;
        timeMax: string;
        items: Array<{ id: string }>;
      };
    }): Promise<{
      data: {
        calendars?: Record<
          string,
          {
            busy?: Array<{ start?: string; end?: string }>;
            errors?: Array<{ reason?: string; domain?: string }>;
          }
        >;
      };
    }>;
  };
  events: {
    list(input: {
      calendarId: string;
      timeMin: string;
      timeMax: string;
      singleEvents: true;
      showDeleted: boolean;
    }): Promise<{ data: { items?: GoogleCalendarApiEvent[] } }>;
    insert(input: {
      calendarId: string;
      requestBody: GoogleCalendarEventWriteInput;
    }): Promise<{ data: GoogleCalendarApiEvent }>;
    patch(input: {
      calendarId: string;
      eventId: string;
      requestBody: GoogleCalendarEventWriteInput;
    }): Promise<{ data: GoogleCalendarApiEvent }>;
    get(input: { calendarId: string; eventId: string }): Promise<{ data: GoogleCalendarApiEvent }>;
    delete(input: { calendarId: string; eventId: string }): Promise<unknown>;
  };
};

export type GoogleCalendarApiEvent = {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
  extendedProperties?: { private?: Record<string, string> | null } | null;
};

export type GoogleCalendarClientOptions = {
  clinicId: string;
  credentialRepository: CalendarCredentialRepository;
  config: GoogleCalendarConfig;
  authClient?: GoogleAuthClient;
  calendarApi?: GoogleCalendarApi;
};

export class GoogleCalendarApiClient implements GoogleCalendarClient {
  private readonly authClient: GoogleAuthClient;
  private readonly calendarApi: GoogleCalendarApi;

  constructor(private readonly options: GoogleCalendarClientOptions) {
    this.authClient = options.authClient ?? createGoogleAuthClient(options.config);
    this.calendarApi = options.calendarApi ?? createGoogleCalendarApi(this.authClient);
  }

  async queryFreeBusy(calendarIds: string[], from: Date, to: Date) {
    await this.authorize();
    const response = await this.calendarApi.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: calendarIds.map((id) => ({ id }))
      }
    });

    const busyIntervals: GoogleCalendarBusyInterval[] = [];
    const calendars = response.data.calendars ?? {};
    for (const calendarId of calendarIds) {
      const calendar = calendars[calendarId];
      if (!calendar || calendar.errors?.length) {
        throw new GoogleCalendarFreeBusyError(calendarId);
      }
      for (const busy of calendar?.busy ?? []) {
        if (busy.start && busy.end) {
          busyIntervals.push({
            calendarId,
            startsAt: new Date(busy.start),
            endsAt: new Date(busy.end)
          });
        }
      }
    }
    return busyIntervals;
  }

  async listEvents(calendarId: string, from: Date, to: Date) {
    await this.authorize();
    const response = await this.calendarApi.events.list({
      calendarId,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      showDeleted: true
    });

    return (response.data.items ?? [])
      .map((event) => toEventResource(calendarId, event))
      .filter((event): event is GoogleCalendarEventResource => event !== undefined);
  }

  async insertEvent(calendarId: string, event: GoogleCalendarEventWriteInput) {
    await this.authorize();
    const response = await this.calendarApi.events.insert({ calendarId, requestBody: event });
    return requireEventResource(calendarId, response.data);
  }

  async updateEvent(calendarId: string, eventId: string, event: GoogleCalendarEventWriteInput) {
    await this.authorize();
    const response = await this.calendarApi.events.patch({
      calendarId,
      eventId,
      requestBody: event
    });
    return requireEventResource(calendarId, response.data);
  }

  async getEvent(calendarId: string, eventId: string) {
    await this.authorize();
    const response = await this.calendarApi.events.get({ calendarId, eventId });
    return toEventResource(calendarId, response.data);
  }

  async deleteEvent(calendarId: string, eventId: string) {
    await this.authorize();
    await this.calendarApi.events.delete({ calendarId, eventId });
  }

  private async authorize() {
    const credentials = await this.options.credentialRepository.get({
      clinicId: this.options.clinicId,
      provider: "google"
    });
    if (!credentials) {
      throw new CalendarInfrastructureError(
        `Google Calendar credentials not found for clinic ${this.options.clinicId}`
      );
    }

    this.authClient.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      expiry_date: credentials.expiryDate?.getTime()
    });
    await this.authClient.getAccessToken();

    const accessToken = this.authClient.credentials?.access_token ?? undefined;
    const expiryDate = this.authClient.credentials?.expiry_date
      ? new Date(this.authClient.credentials.expiry_date)
      : undefined;
    if (accessToken && accessToken !== credentials.accessToken) {
      await this.options.credentialRepository.save({
        clinicId: credentials.clinicId,
        provider: credentials.provider,
        providerAccountEmail: credentials.providerAccountEmail,
        scopes: credentials.scopes,
        accessToken,
        refreshToken: credentials.refreshToken,
        expiryDate
      });
    }
  }
}

function createGoogleAuthClient(config: GoogleCalendarConfig): GoogleAuthClient {
  return new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri
  });
}

function createGoogleCalendarApi(auth: GoogleAuthClient): GoogleCalendarApi {
  return google.calendar({
    version: "v3",
    auth: auth as OAuth2Client
  }) as unknown as GoogleCalendarApi;
}

function requireEventResource(calendarId: string, event: GoogleCalendarApiEvent) {
  const resource = toEventResource(calendarId, event);
  if (!resource) {
    throw new Error("Google Calendar returned an event without required date fields");
  }
  return resource;
}

function toEventResource(
  calendarId: string,
  event: GoogleCalendarApiEvent
): GoogleCalendarEventResource | undefined {
  const id = event.id ?? undefined;
  const startsAt = parseGoogleEventDate(event.start);
  const endsAt = parseGoogleEventDate(event.end);
  if (!id || !startsAt || !endsAt) {
    return undefined;
  }

  return {
    id,
    calendarId,
    summary: event.summary ?? "",
    startsAt,
    endsAt,
    metadata: event.extendedProperties?.private ?? {},
    status: event.status === "cancelled" ? "cancelled" : "confirmed"
  };
}

function parseGoogleEventDate(input: GoogleCalendarApiEvent["start"]) {
  const value = input?.dateTime ?? input?.date ?? undefined;
  return value ? new Date(value) : undefined;
}
