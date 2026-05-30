import { describe, expect, it } from "vitest";
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import {
  GoogleCalendarApiClient,
  type GoogleCalendarApi
} from "../src/adapters/google/google-calendar-client.js";
import { GOOGLE_CALENDAR_SCOPES, type GoogleCalendarConfig } from "../src/config/google-calendar.js";

const config: GoogleCalendarConfig = {
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  redirectUri: "http://localhost:3000/integrations/google-calendar/callback",
  stateSecret: "google-state-secret",
  setupToken: "google-setup-token",
  scopes: [...GOOGLE_CALENDAR_SCOPES]
};

describe("GoogleCalendarApiClient calendar discovery", () => {
  it("lists non-deleted calendars, follows pagination, and marks writable calendars as bookable", async () => {
    const credentials = new InMemoryCalendarCredentialRepository();
    await credentials.save({
      clinicId: "clinic_discovery",
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "access_token",
      refreshToken: "refresh_token"
    });
    const calendarApi = new FakeGoogleCalendarApi();
    const client = new GoogleCalendarApiClient({
      clinicId: "clinic_discovery",
      credentialRepository: credentials,
      config,
      authClient: new FakeGoogleAuthClient(),
      calendarApi
    });

    await expect(client.listCalendars()).resolves.toEqual([
      {
        id: "primary@example.com",
        summary: "Clinica Principal",
        primary: true,
        accessRole: "owner",
        timeZone: "America/Argentina/Buenos_Aires",
        bookable: true
      },
      {
        id: "dra-perez@example.com",
        summary: "Dra. Perez",
        primary: false,
        accessRole: "writer",
        timeZone: "America/Argentina/Buenos_Aires",
        bookable: true
      },
      {
        id: "read-only@example.com",
        summary: "Read Only",
        primary: false,
        accessRole: "reader",
        timeZone: undefined,
        bookable: false
      }
    ]);
    expect(calendarApi.calendarListTokens).toEqual([undefined, "page_2"]);
  });
});

class FakeGoogleAuthClient {
  credentials = { access_token: "access_token" };
  setCredentials() {}
  async getAccessToken() {
    return "access_token";
  }
}

class FakeGoogleCalendarApi implements GoogleCalendarApi {
  readonly calendarListTokens: Array<string | undefined> = [];

  readonly calendarList = {
    list: async (input: { pageToken?: string; showDeleted: false }) => {
      this.calendarListTokens.push(input.pageToken);
      if (!input.pageToken) {
        return {
          data: {
            nextPageToken: "page_2",
            items: [
              {
                id: "primary@example.com",
                summary: "Clinica Principal",
                primary: true,
                accessRole: "owner",
                timeZone: "America/Argentina/Buenos_Aires",
                deleted: false
              },
              {
                id: "deleted@example.com",
                summary: "Deleted",
                accessRole: "owner",
                deleted: true
              }
            ]
          }
        };
      }
      return {
        data: {
          items: [
            {
              id: "dra-perez@example.com",
              summary: "Dra. Perez",
              accessRole: "writer",
              timeZone: "America/Argentina/Buenos_Aires",
              deleted: false
            },
            {
              id: "read-only@example.com",
              summary: "Read Only",
              accessRole: "reader",
              deleted: false
            }
          ]
        }
      };
    }
  };

  readonly freebusy = {
    query: async () => ({ data: { calendars: {} } })
  };

  readonly events = {
    list: async () => ({ data: { items: [] } }),
    insert: async () => ({ data: {} }),
    patch: async () => ({ data: {} }),
    get: async () => ({ data: {} }),
    delete: async () => ({})
  };
}
