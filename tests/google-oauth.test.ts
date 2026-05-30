import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "../src/adapters/prisma/calendar-auth-repository.js";
import { buildApp } from "../src/api/app.js";
import type { GoogleOAuthClient } from "../src/adapters/google/google-oauth.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleOAuthService
} from "../src/adapters/google/google-oauth.js";
import {
  readGoogleCalendarConfig,
  type GoogleCalendarConfig
} from "../src/config/google-calendar.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

const googleCalendarScope = "https://www.googleapis.com/auth/calendar.events";
describe("InMemoryCalendarCredentialRepository", () => {
  it("saves and reads a Google refresh token by clinicId", async () => {
    const repository = new InMemoryCalendarCredentialRepository();
    const expiryDate = new Date("2026-06-01T12:00:00.000Z");

    await repository.save({
      clinicId: "clinic_google_oauth_memory",
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken: "google_refresh_token",
      expiryDate
    });

    const credentials = await repository.get({
      clinicId: "clinic_google_oauth_memory",
      provider: "google"
    });

    expect(credentials).toMatchObject({
      clinicId: "clinic_google_oauth_memory",
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken: "google_refresh_token",
      expiryDate
    });
  });

  it("returns undefined when credentials are missing", async () => {
    const repository = new InMemoryCalendarCredentialRepository();

    await expect(
      repository.get({
        clinicId: "clinic_without_credentials",
        provider: "google"
      })
    ).resolves.toBeUndefined();
  });
});

describe("PrismaCalendarCredentialRepository", () => {
  const clinicId = "clinic_google_oauth_prisma";
  const cipher = new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4));
  let prisma: PrismaClient;
  let repository: PrismaCalendarCredentialRepository;
  let context: PrismaTestContext;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-google-oauth-test-");
    prisma = context.prisma;
    repository = new PrismaCalendarCredentialRepository(prisma, cipher);

    await prisma.clinic.upsert({
      where: { id: clinicId },
      update: {},
      create: {
        id: clinicId,
        name: "Calendar Test Clinic",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("stores encrypted tokens without exposing the raw refresh token string", async () => {
    const refreshToken = "raw_google_refresh_token_for_storage";

    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken,
      expiryDate: new Date("2026-06-01T12:00:00.000Z")
    });

    const stored = await prisma.calendarConnection.findUnique({
      where: { clinicId_provider: { clinicId, provider: "google" } },
      select: { encryptedRefreshToken: true }
    });
    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(stored?.encryptedRefreshToken).toBeDefined();
    expect(stored?.encryptedRefreshToken).not.toContain(refreshToken);
    expect(credentials?.refreshToken).toBe(refreshToken);
  });

  it("preserves the existing refresh token when only access token details change", async () => {
    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "old_access_token",
      refreshToken: "stable_refresh_token",
      expiryDate: new Date("2026-06-01T12:00:00.000Z")
    });

    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "new_access_token",
      expiryDate: new Date("2026-06-01T13:00:00.000Z")
    });

    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(credentials?.accessToken).toBe("new_access_token");
    expect(credentials?.refreshToken).toBe("stable_refresh_token");
    expect(credentials?.expiryDate).toEqual(new Date("2026-06-01T13:00:00.000Z"));
  });

  it("returns undefined from Prisma storage when credentials are missing", async () => {
    await expect(
      repository.get({
        clinicId: "clinic_without_prisma_credentials",
        provider: "google"
      })
    ).resolves.toBeUndefined();
  });
});

describe("Aes256GcmTokenCipher", () => {
  it("rejects encrypted token payloads with non-canonical tag length", () => {
    const cipher = new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4));
    const encrypted = cipher.encrypt("sensitive_refresh_token");
    const [version, iv, authTag, payload] = encrypted.split(":");
    const truncatedTag = Buffer.from(authTag ?? "", "base64").subarray(0, 4).toString("base64");

    expect(() => cipher.decrypt([version, iv, truncatedTag, payload].join(":"))).toThrow(
      "Invalid encrypted token payload"
    );
  });
});

describe("Google Calendar OAuth routes", () => {
  const config: GoogleCalendarConfig = {
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    redirectUri: "http://localhost:3000/integrations/google-calendar/callback",
    stateSecret: "google-state-secret",
    setupToken: "google-setup-token",
    scopes: [...GOOGLE_CALENDAR_SCOPES]
  };

  it("reads Google Calendar config from env and rejects invalid redirect URIs", () => {
    expect(
      readGoogleCalendarConfig({
        GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
        GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/integrations/google-calendar/callback",
        GOOGLE_CALENDAR_OAUTH_STATE_SECRET: "google-state-secret",
        GOOGLE_CALENDAR_SETUP_TOKEN: "google-setup-token"
      })
    ).toEqual(config);
    expect(() =>
      readGoogleCalendarConfig({
        GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
        GOOGLE_CALENDAR_REDIRECT_URI: "not a url",
        GOOGLE_CALENDAR_SETUP_TOKEN: "google-setup-token"
      })
    ).toThrow("GOOGLE_CALENDAR_REDIRECT_URI must be a valid URL");
  });

  it("redirects OAuth start to Google with offline access, consent, state, and approved scopes", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config);
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });

    const response = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/start?clinicId=clinic_google_oauth&setupToken=${config.setupToken}`
    });
    const redirectUrl = new URL(String(response.headers.location));
    const state = redirectUrl.searchParams.get("state");

    expect(response.statusCode).toBe(302);
    expect(redirectUrl.origin).toBe("https://accounts.google.com");
    expect(redirectUrl.searchParams.get("client_id")).toBe(config.clientId);
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(redirectUrl.searchParams.get("access_type")).toBe("offline");
    expect(redirectUrl.searchParams.get("prompt")).toBe("consent");
    expect(redirectUrl.searchParams.get("scope")?.split(" ").sort()).toEqual(
      [...GOOGLE_CALENDAR_SCOPES].sort()
    );
    expect(state).toEqual(expect.any(String));
  });

  it("requires the setup token before starting OAuth for a clinic", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config);
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });

    const response = await app.inject({
      method: "GET",
      url: "/integrations/google-calendar/start?clinicId=clinic_google_oauth"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized_google_calendar_oauth_start" });
  });

  it("exchanges callback code for tokens and stores them for the clinic", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config, {
      access_token: "google_access_token_from_callback",
      refresh_token: "google_refresh_token_from_callback",
      expiry_date: Date.parse("2026-06-01T12:00:00.000Z"),
      scope: GOOGLE_CALENDAR_SCOPES.join(" ")
    });
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });
    const clinicId = "clinic.google.oauth.callback";
    const start = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/start?clinicId=${encodeURIComponent(clinicId)}&setupToken=${config.setupToken}`
    });
    const state = new URL(String(start.headers.location)).searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/callback?code=oauth_code&state=${encodeURIComponent(state ?? "")}`
    });
    const credentials = await repository.get({
      clinicId,
      provider: "google"
    });

    expect(callback.statusCode).toBe(200);
    expect(callback.json()).toEqual({
      status: "connected",
      clinicId
    });
    expect(oauthClient.tokenCalls).toEqual([{ code: "oauth_code" }]);
    expect(credentials).toMatchObject({
      clinicId,
      provider: "google",
      accessToken: "google_access_token_from_callback",
      refreshToken: "google_refresh_token_from_callback",
      expiryDate: new Date("2026-06-01T12:00:00.000Z"),
      scopes: [...GOOGLE_CALENDAR_SCOPES]
    });
    expect(credentials?.providerAccountEmail).toBeUndefined();
  });

  it("redirects OAuth callback to a signed internal return path when provided", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config, {
      access_token: "google_access_token_return_path",
      refresh_token: "google_refresh_token_return_path",
      expiry_date: Date.parse("2026-06-01T12:00:00.000Z"),
      scope: GOOGLE_CALENDAR_SCOPES.join(" ")
    });
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });
    const clinicId = "clinic_google_oauth_return_path";
    const returnPath = `/internal/onboarding/clinics/${clinicId}?googleCalendar=connected`;
    const startUrl = service.createAuthorizationUrl(clinicId, { returnPath });
    const state = new URL(startUrl).searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/callback?code=oauth_code&state=${encodeURIComponent(state ?? "")}`
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(returnPath);
    await expect(repository.get({ clinicId, provider: "google" })).resolves.toMatchObject({
      clinicId,
      provider: "google",
      refreshToken: "google_refresh_token_return_path"
    });
    await app.close();
  });

  it("rejects OAuth return paths that are not internal onboarding paths", () => {
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(
      config,
      repository,
      () => new FakeGoogleOAuthClient(config)
    );

    expect(() =>
      service.createAuthorizationUrl("clinic_google_oauth_bad_return", {
        returnPath: "https://evil.example.com/callback"
      })
    ).toThrow("Invalid Google OAuth return path");
  });

  it("rejects callback tokens that do not include all required calendar scopes", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config, {
      access_token: "partial_scope_access_token",
      refresh_token: "partial_scope_refresh_token",
      expiry_date: Date.parse("2026-06-01T12:00:00.000Z"),
      scope: googleCalendarScope
    });
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });
    const clinicId = "clinic_google_oauth_partial_scope";
    const start = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/start?clinicId=${clinicId}&setupToken=${config.setupToken}`
    });
    const state = new URL(String(start.headers.location)).searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/callback?code=partial_scope_code&state=${encodeURIComponent(state ?? "")}`
    });
    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(callback.statusCode).toBe(400);
    expect(callback.json()).toEqual({ error: "invalid_google_calendar_oauth_callback" });
    expect(credentials).toBeUndefined();
  });

  it("preserves an existing refresh token when a reconnect callback omits it", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config, {
      access_token: "new_google_access_token",
      expiry_date: Date.parse("2026-06-01T14:00:00.000Z"),
      scope: GOOGLE_CALENDAR_SCOPES.join(" ")
    });
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });
    const clinicId = "clinic_google_oauth_reconnect";
    await repository.save({
      clinicId,
      provider: "google",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      accessToken: "old_google_access_token",
      refreshToken: "existing_google_refresh_token",
      expiryDate: new Date("2026-06-01T12:00:00.000Z")
    });
    const start = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/start?clinicId=${encodeURIComponent(clinicId)}&setupToken=${config.setupToken}`
    });
    const state = new URL(String(start.headers.location)).searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/integrations/google-calendar/callback?code=reconnect_code&state=${encodeURIComponent(state ?? "")}`
    });
    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(callback.statusCode).toBe(200);
    expect(credentials?.accessToken).toBe("new_google_access_token");
    expect(credentials?.refreshToken).toBe("existing_google_refresh_token");
    expect(credentials?.expiryDate).toEqual(new Date("2026-06-01T14:00:00.000Z"));
  });

  it("returns 400 for invalid callback state", async () => {
    const oauthClient = new FakeGoogleOAuthClient(config);
    const repository = new InMemoryCalendarCredentialRepository();
    const service = new GoogleOAuthService(config, repository, () => oauthClient);
    const app = buildApp({
      googleCalendarOAuthService: service,
      googleCalendarSetupToken: config.setupToken
    });

    const response = await app.inject({
      method: "GET",
      url: "/integrations/google-calendar/callback?code=oauth_code&state=invalid_state"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_google_calendar_oauth_callback" });
    expect(oauthClient.tokenCalls).toEqual([]);
  });
});

type FakeGoogleOAuthTokens = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
};

class FakeGoogleOAuthClient implements GoogleOAuthClient {
  readonly tokenCalls: Array<{ code: string }> = [];

  constructor(
    private readonly config: GoogleCalendarConfig,
    private readonly tokens: FakeGoogleOAuthTokens = {
      access_token: "google_access_token",
      refresh_token: "google_refresh_token",
      expiry_date: Date.parse("2026-06-01T12:00:00.000Z"),
      scope: GOOGLE_CALENDAR_SCOPES.join(" ")
    }
  ) {}

  generateAuthUrl(input: {
    access_type: "offline";
    prompt: "consent";
    scope: string[];
    state: string;
    include_granted_scopes: boolean;
  }) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      access_type: input.access_type,
      prompt: input.prompt,
      scope: input.scope.join(" "),
      state: input.state,
      include_granted_scopes: String(input.include_granted_scopes)
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async getToken(input: { code: string }) {
    this.tokenCalls.push(input);
    return { tokens: this.tokens };
  }
}
