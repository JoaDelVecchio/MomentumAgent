import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type {
  GoogleCalendarConnectionStatus,
  GoogleCalendarOnboardingService
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
});

class FakeGoogleCalendarOnboardingService implements Pick<
  GoogleCalendarOnboardingService,
  "status" | "createAuthorizationUrl" | "listCalendars"
> {
  readonly statusCalls: string[] = [];

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
    return `https://accounts.google.com/o/oauth2/v2/auth?clinicId=${clinicId}&returnPath=${encodeURIComponent(returnPath)}`;
  }

  async listCalendars() {
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
