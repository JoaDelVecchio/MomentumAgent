import { describe, expect, it } from "vitest";
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import {
  GoogleCalendarOnboardingService,
  googleCalendarConnectionStatus
} from "../src/application/onboarding/google-calendar-onboarding-service.js";
import { GOOGLE_CALENDAR_SCOPES } from "../src/config/google-calendar.js";

const calendarListScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

describe("GoogleCalendarOnboardingService", () => {
  it("includes the calendar-list readonly scope in the required Google scopes", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toContain(calendarListScope);
  });

  it("reports missing credentials as disconnected", async () => {
    const credentials = new InMemoryCalendarCredentialRepository();
    const service = new GoogleCalendarOnboardingService({
      credentials,
      requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      calendarClientFactory: () => new FakeCalendarDiscoveryClient([])
    });

    await expect(service.status("clinic_status_missing")).resolves.toEqual({
      provider: "google",
      connected: false,
      reconnectRequired: true,
      requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      grantedScopes: [],
      missingScopes: [...GOOGLE_CALENDAR_SCOPES]
    });
  });

  it("reports reconnectRequired when stored credentials are missing the calendar-list scope", async () => {
    const credentials = new InMemoryCalendarCredentialRepository();
    await credentials.save({
      clinicId: "clinic_status_partial",
      provider: "google",
      scopes: GOOGLE_CALENDAR_SCOPES.filter((scope) => scope !== calendarListScope),
      accessToken: "access_token",
      refreshToken: "refresh_token"
    });
    const service = new GoogleCalendarOnboardingService({
      credentials,
      requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      calendarClientFactory: () => new FakeCalendarDiscoveryClient([])
    });

    await expect(service.status("clinic_status_partial")).resolves.toEqual({
      provider: "google",
      connected: true,
      reconnectRequired: true,
      requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      grantedScopes: GOOGLE_CALENDAR_SCOPES.filter((scope) => scope !== calendarListScope),
      missingScopes: [calendarListScope]
    });
  });

  it("reports connected when all required scopes are present", async () => {
    const credentials = new InMemoryCalendarCredentialRepository();
    await credentials.save({
      clinicId: "clinic_status_complete",
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "access_token",
      refreshToken: "refresh_token"
    });
    const service = new GoogleCalendarOnboardingService({
      credentials,
      requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      calendarClientFactory: () => new FakeCalendarDiscoveryClient([])
    });

    await expect(service.status("clinic_status_complete")).resolves.toMatchObject({
      provider: "google",
      connected: true,
      reconnectRequired: false,
      missingScopes: []
    });
  });

  it("exposes a pure status helper for readiness code", () => {
    expect(
      googleCalendarConnectionStatus({
        credentials: {
          id: "calendar_connection_1",
          clinicId: "clinic_status_helper",
          provider: "google",
          scopes: [...GOOGLE_CALENDAR_SCOPES],
          accessToken: "access_token",
          refreshToken: "refresh_token",
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          updatedAt: new Date("2026-06-01T12:00:00.000Z")
        },
        requiredScopes: [...GOOGLE_CALENDAR_SCOPES]
      }).reconnectRequired
    ).toBe(false);
  });
});

class FakeCalendarDiscoveryClient {
  constructor(private readonly calendars: []) {}

  async listCalendars() {
    return this.calendars;
  }
}
