import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import {
  GoogleCalendarOnboardingError,
  type GoogleCalendarConnectionStatus,
  type GoogleCalendarOnboardingService
} from "../src/application/onboarding/google-calendar-onboarding-service.js";

describe("Google calendar onboarding routes", () => {
  it("protects Google calendar onboarding routes with the admin token", async () => {
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service: new FakeGoogleCalendarOnboardingService()
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/status"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("returns Google calendar connection status", async () => {
    const service = new FakeGoogleCalendarOnboardingService();
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/status",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: {
        provider: "google",
        connected: true,
        reconnectRequired: false,
        requiredScopes: ["scope_a"],
        grantedScopes: ["scope_a"],
        missingScopes: []
      }
    });
    expect(service.statusCalls).toEqual(["clinic_google"]);
    await app.close();
  });

  it("returns 401 for unauthenticated Google calendar onboarding start without calling service", async () => {
    const service = new FakeGoogleCalendarOnboardingService();
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/start"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(service.createAuthorizationUrlCalls).toEqual([]);
    await app.close();
  });

  it("returns a Google authorization URL for authenticated onboarding start", async () => {
    const service = new FakeGoogleCalendarOnboardingService();
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/start",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authorizationUrl:
        "https://accounts.google.com/o/oauth2/v2/auth?clinicId=clinic_google&returnPath=%2Finternal%2Fonboarding%2Fclinics%2Fclinic_google%3FgoogleCalendar%3Dconnected"
    });
    await app.close();
  });

  it("maps missing Google OAuth configuration to 503 for onboarding start", async () => {
    const service = new FakeGoogleCalendarOnboardingService({
      createAuthorizationUrlError: new GoogleCalendarOnboardingError(
        "google_calendar_oauth_not_configured"
      )
    });
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/start",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "google_calendar_oauth_not_configured" });
    await app.close();
  });

  it("returns 401 for unauthenticated Google calendar calendars without calling service", async () => {
    const service = new FakeGoogleCalendarOnboardingService();
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/calendars"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(service.listCalendarsCalls).toEqual([]);
    await app.close();
  });

  it("returns calendars for connected clinics", async () => {
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service: new FakeGoogleCalendarOnboardingService()
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/calendars",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      calendars: [
        {
          id: "dra-perez@example.com",
          summary: "Dra. Perez",
          primary: false,
          accessRole: "writer",
          timeZone: "America/Argentina/Buenos_Aires",
          bookable: true
        }
      ]
    });
    await app.close();
  });

  it("maps missing Google calendar connection to 409 for calendars", async () => {
    const service = new FakeGoogleCalendarOnboardingService({
      listCalendarsError: new GoogleCalendarOnboardingError("google_calendar_not_connected")
    });
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/calendars",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "google_calendar_not_connected" });
    await app.close();
  });

  it("maps required Google calendar reconnect to 409 for calendars", async () => {
    const service = new FakeGoogleCalendarOnboardingService({
      listCalendarsError: new GoogleCalendarOnboardingError("google_calendar_reconnect_required")
    });
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/calendars",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "google_calendar_reconnect_required" });
    await app.close();
  });

  it("maps non-bookable Google calendar to 409 for calendars", async () => {
    const service = new FakeGoogleCalendarOnboardingService({
      listCalendarsError: new GoogleCalendarOnboardingError("google_calendar_calendar_not_bookable")
    });
    const app = buildApp({
      googleCalendarOnboarding: {
        adminToken: "secret",
        service
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/onboarding/clinics/clinic_google/google-calendar/calendars",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "google_calendar_calendar_not_bookable" });
    await app.close();
  });
});

type FakeGoogleCalendarOnboardingServiceOptions = {
  createAuthorizationUrlError?: GoogleCalendarOnboardingError;
  listCalendarsError?: GoogleCalendarOnboardingError;
};

class FakeGoogleCalendarOnboardingService implements Pick<
  GoogleCalendarOnboardingService,
  "status" | "createAuthorizationUrl" | "listCalendars"
> {
  readonly statusCalls: string[] = [];
  readonly createAuthorizationUrlCalls: Array<{ clinicId: string; returnPath: string }> = [];
  readonly listCalendarsCalls: string[] = [];

  constructor(private readonly options: FakeGoogleCalendarOnboardingServiceOptions = {}) {}

  async status(clinicId: string): Promise<GoogleCalendarConnectionStatus> {
    this.statusCalls.push(clinicId);
    return {
      provider: "google",
      connected: true,
      reconnectRequired: false,
      requiredScopes: ["scope_a"],
      grantedScopes: ["scope_a"],
      missingScopes: []
    };
  }

  createAuthorizationUrl(clinicId: string, returnPath: string): string {
    this.createAuthorizationUrlCalls.push({ clinicId, returnPath });
    if (this.options.createAuthorizationUrlError) {
      throw this.options.createAuthorizationUrlError;
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?clinicId=${clinicId}&returnPath=${encodeURIComponent(returnPath)}`;
  }

  async listCalendars(clinicId: string) {
    this.listCalendarsCalls.push(clinicId);
    if (this.options.listCalendarsError) {
      throw this.options.listCalendarsError;
    }
    return [
      {
        id: "dra-perez@example.com",
        summary: "Dra. Perez",
        primary: false,
        accessRole: "writer",
        timeZone: "America/Argentina/Buenos_Aires",
        bookable: true
      }
    ];
  }
}
