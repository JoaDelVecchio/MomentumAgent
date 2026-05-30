# Google Calendar Onboarding Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private onboarding flow that connects Google Calendar, discovers calendars, maps professionals to writable calendars, and makes activation readiness depend on the real connection and mappings.

**Architecture:** Keep scheduling behind the existing `CalendarPort`, and add a separate onboarding-only Google Calendar discovery path. OAuth credentials remain in `CalendarConnection`; professional mappings remain in `Professional.calendarId` through the clinic profile. The web onboarding page calls protected internal API endpoints, receives a Google authorization URL, then maps discovered calendars into the existing profile JSON before saving.

**Tech Stack:** TypeScript, Fastify, Prisma SQLite, Google Calendar API through `googleapis`, Vitest, Next.js App Router, React.

---

## File Structure

- Modify `src/config/google-calendar.ts`: add the calendar-list scope to the required Google scope list.
- Modify `src/adapters/google/google-oauth.ts`: support signed OAuth state with an optional internal return path.
- Modify `src/api/google-calendar-routes.ts`: redirect OAuth callbacks back to onboarding when the signed state includes a return path.
- Modify `src/adapters/google/google-calendar-client.ts`: add calendar-list discovery.
- Create `src/application/onboarding/google-calendar-onboarding-service.ts`: status, scope checks, calendar discovery, and mapping validation helpers for onboarding.
- Modify `src/application/onboarding/onboarding-service.ts`: calculate calendar readiness from credentials and profile mappings when a calendar credential repository is configured.
- Create `src/api/google-calendar-onboarding-routes.ts`: protected internal status, start, and calendars endpoints.
- Modify `src/api/app.ts`: register the new internal Google onboarding routes.
- Modify `src/runtime/server-runtime.ts`: expose Google credential/config dependencies to onboarding.
- Modify `src/server.ts`: wire Google calendar onboarding services into private onboarding when Google runtime is configured.
- Modify `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`: add calendar connection, calendar list, and professional mapping UI.
- Modify `apps/web/src/lib/types.ts`: add Google calendar onboarding response types.
- Modify `README.md`: replace manual seeded `calendarId` instructions with onboarding mapping instructions.
- Add and modify Vitest files listed per task.

## Task 1: Add Calendar-List Scope And Status Service

**Files:**
- Modify: `src/config/google-calendar.ts`
- Create: `src/application/onboarding/google-calendar-onboarding-service.ts`
- Test: `tests/google-calendar-onboarding-service.test.ts`
- Modify: `tests/google-oauth.test.ts`

- [ ] **Step 1: Write failing tests for the new required scope and status behavior**

Add `tests/google-calendar-onboarding-service.test.ts`:

```ts
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
```

Update the OAuth route test in `tests/google-oauth.test.ts` so the expected scope list includes `GOOGLE_CALENDAR_SCOPES` instead of a two-scope literal:

```ts
expect(redirectUrl.searchParams.get("scope")?.split(" ").sort()).toEqual(
  [...GOOGLE_CALENDAR_SCOPES].sort()
);
```

Update every successful callback token fixture in `tests/google-oauth.test.ts` to grant all required scopes:

```ts
scope: GOOGLE_CALENDAR_SCOPES.join(" ")
```

Keep the insufficient-scope test intentionally partial:

```ts
scope: googleCalendarScope
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/google-calendar-onboarding-service.test.ts tests/google-oauth.test.ts
```

Expected: FAIL because `GoogleCalendarOnboardingService` does not exist and `GOOGLE_CALENDAR_SCOPES` does not contain `calendar.calendarlist.readonly`.

- [ ] **Step 3: Implement scope and status service**

Update `src/config/google-calendar.ts`:

```ts
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
] as const;
```

Create `src/application/onboarding/google-calendar-onboarding-service.ts` with these exports:

```ts
import type { CalendarCredentialRepository, CalendarCredentials } from "../../ports/calendar-auth.js";

export type GoogleCalendarConnectionStatus = {
  provider: "google";
  connected: boolean;
  reconnectRequired: boolean;
  requiredScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  bookable: boolean;
};

export type GoogleCalendarDiscoveryClient = {
  listCalendars(): Promise<GoogleCalendarSummary[]>;
};

export type GoogleCalendarOnboardingServiceOptions = {
  credentials: CalendarCredentialRepository;
  requiredScopes: string[];
  oauthService?: { createAuthorizationUrl(clinicId: string, options?: { returnPath?: string }): string };
  calendarClientFactory: (clinicId: string) => GoogleCalendarDiscoveryClient;
};

export class GoogleCalendarOnboardingService {
  constructor(private readonly options: GoogleCalendarOnboardingServiceOptions) {}

  async status(clinicId: string): Promise<GoogleCalendarConnectionStatus> {
    const credentials = await this.options.credentials.get({ clinicId, provider: "google" });
    return googleCalendarConnectionStatus({
      credentials,
      requiredScopes: this.options.requiredScopes
    });
  }

  async listCalendars(clinicId: string): Promise<GoogleCalendarSummary[]> {
    const status = await this.status(clinicId);
    if (!status.connected) {
      throw new GoogleCalendarOnboardingError("google_calendar_not_connected");
    }
    if (status.reconnectRequired) {
      throw new GoogleCalendarOnboardingError("google_calendar_reconnect_required");
    }

    return this.options.calendarClientFactory(clinicId).listCalendars();
  }
}

export class GoogleCalendarOnboardingError extends Error {
  constructor(
    readonly code: "google_calendar_not_connected" | "google_calendar_reconnect_required" | "google_calendar_calendar_not_bookable"
  ) {
    super(code);
  }
}

export function googleCalendarConnectionStatus(input: {
  credentials: CalendarCredentials | undefined;
  requiredScopes: string[];
}): GoogleCalendarConnectionStatus {
  const grantedScopes = input.credentials?.scopes ?? [];
  const grantedScopeSet = new Set(grantedScopes);
  const missingScopes = input.requiredScopes.filter((scope) => !grantedScopeSet.has(scope));
  return {
    provider: "google",
    connected: Boolean(input.credentials),
    reconnectRequired: !input.credentials || missingScopes.length > 0,
    requiredScopes: [...input.requiredScopes],
    grantedScopes: [...grantedScopes],
    missingScopes
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/google-calendar-onboarding-service.test.ts tests/google-oauth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/google-calendar.ts src/application/onboarding/google-calendar-onboarding-service.ts tests/google-calendar-onboarding-service.test.ts tests/google-oauth.test.ts
git commit -m "feat: add google calendar onboarding status"
```

## Task 2: Add Calendar Discovery To The Google Client

**Files:**
- Modify: `src/adapters/google/google-calendar-client.ts`
- Test: `tests/google-calendar-client.test.ts`

- [ ] **Step 1: Write failing discovery tests**

Create `tests/google-calendar-client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/google-calendar-client.test.ts
```

Expected: FAIL because `GoogleCalendarApiClient.listCalendars` and `GoogleCalendarApi.calendarList` are not defined.

- [ ] **Step 3: Implement calendar discovery**

Update `src/adapters/google/google-calendar-client.ts`:

```ts
export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  bookable: boolean;
};

export interface GoogleCalendarClient {
  listCalendars(): Promise<GoogleCalendarSummary[]>;
  queryFreeBusy(calendarIds: string[], from: Date, to: Date): Promise<GoogleCalendarBusyInterval[]>;
  listEvents(calendarId: string, from: Date, to: Date): Promise<GoogleCalendarEventResource[]>;
  insertEvent(calendarId: string, event: GoogleCalendarEventWriteInput): Promise<GoogleCalendarEventResource>;
  updateEvent(calendarId: string, eventId: string, event: GoogleCalendarEventWriteInput): Promise<GoogleCalendarEventResource>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEventResource | undefined>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}
```

Extend `GoogleCalendarApi`:

```ts
calendarList: {
  list(input: {
    pageToken?: string;
    showDeleted: false;
  }): Promise<{
    data: {
      nextPageToken?: string | null;
      items?: GoogleCalendarApiCalendarListEntry[];
    };
  }>;
};
```

Add:

```ts
export type GoogleCalendarApiCalendarListEntry = {
  id?: string | null;
  summary?: string | null;
  primary?: boolean | null;
  accessRole?: string | null;
  timeZone?: string | null;
  deleted?: boolean | null;
};
```

Implement on `GoogleCalendarApiClient`:

```ts
async listCalendars(): Promise<GoogleCalendarSummary[]> {
  await this.authorize();
  const calendars: GoogleCalendarSummary[] = [];
  let pageToken: string | undefined;

  do {
    const response = await this.calendarApi.calendarList.list({
      pageToken,
      showDeleted: false
    });
    for (const item of response.data.items ?? []) {
      const calendar = toCalendarSummary(item);
      if (calendar) {
        calendars.push(calendar);
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return calendars;
}
```

Add helper:

```ts
function toCalendarSummary(item: GoogleCalendarApiCalendarListEntry): GoogleCalendarSummary | undefined {
  if (!item.id || !item.summary || item.deleted) {
    return undefined;
  }
  const accessRole = item.accessRole ?? "none";
  return {
    id: item.id,
    summary: item.summary,
    primary: item.primary === true,
    accessRole,
    timeZone: item.timeZone ?? undefined,
    bookable: accessRole === "owner" || accessRole === "writer"
  };
}
```

Update `createGoogleCalendarApi` to return `google.calendar({ version: "v3", auth }).calendarList` through the existing API object.

Update `FakeGoogleCalendarClient` in `tests/google-calendar-adapter.test.ts` so it still satisfies `GoogleCalendarClient`:

```ts
async listCalendars() {
  return [];
}
```

Update `FakeGoogleCalendarApi` in `tests/google-calendar-adapter.test.ts` so it still satisfies `GoogleCalendarApi`:

```ts
readonly calendarList = {
  list: async () => ({ data: { items: [] } })
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/google-calendar-client.test.ts tests/google-calendar-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/google-calendar-client.ts tests/google-calendar-client.test.ts
git commit -m "feat: discover google calendars"
```

## Task 3: Support OAuth Return Paths For Onboarding

**Files:**
- Modify: `src/adapters/google/google-oauth.ts`
- Modify: `src/api/google-calendar-routes.ts`
- Test: `tests/google-oauth.test.ts`

- [ ] **Step 1: Write failing OAuth return-path tests**

Add to `tests/google-oauth.test.ts`:

```ts
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
  const service = new GoogleOAuthService(config, repository, () => new FakeGoogleOAuthClient(config));

  expect(() =>
    service.createAuthorizationUrl("clinic_google_oauth_bad_return", {
      returnPath: "https://evil.example.com/callback"
    })
  ).toThrow("Invalid Google OAuth return path");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/google-oauth.test.ts
```

Expected: FAIL because `createAuthorizationUrl` does not accept `returnPath` and the callback always returns JSON.

- [ ] **Step 3: Implement signed return path**

Update `src/adapters/google/google-oauth.ts`:

```ts
export type GoogleOAuthStatePayload = {
  clinicId: string;
  nonce: string;
  returnPath?: string;
};

export type GoogleAuthorizationUrlOptions = {
  returnPath?: string;
};
```

Change:

```ts
createAuthorizationUrl(clinicId: string, options: GoogleAuthorizationUrlOptions = {}) {
  const returnPath = options.returnPath ? assertAllowedReturnPath(options.returnPath, clinicId) : undefined;
  return this.client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: this.config.scopes,
    state: encodeGoogleOAuthState({ clinicId, returnPath }, this.config.stateSecret),
    include_granted_scopes: true
  });
}
```

Change `handleCallback` return:

```ts
const statePayload = decodeGoogleOAuthState(state, this.config.stateSecret);
const clinicId = statePayload.clinicId;
return { clinicId, returnPath: statePayload.returnPath };
```

Implement:

```ts
function assertAllowedReturnPath(returnPath: string, clinicId: string) {
  if (
    returnPath.startsWith(`/internal/onboarding/clinics/${encodeURIComponent(clinicId)}`) ||
    returnPath.startsWith(`/internal/onboarding/clinics/${clinicId}`)
  ) {
    return returnPath;
  }
  throw new Error("Invalid Google OAuth return path");
}
```

Update state encode/decode to store a JSON payload with `clinicId`, generated `nonce`, and optional `returnPath`.

Update `src/api/google-calendar-routes.ts` callback:

```ts
const result = await options.oauthService.handleCallback(parsed.data.code, parsed.data.state);
if (result.returnPath) {
  return reply.redirect(result.returnPath);
}
return reply.send({ status: "connected", clinicId: result.clinicId });
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/google-oauth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/google/google-oauth.ts src/api/google-calendar-routes.ts tests/google-oauth.test.ts
git commit -m "feat: return google oauth to onboarding"
```

## Task 4: Add Protected Internal Google Calendar Onboarding API

**Files:**
- Create: `src/api/google-calendar-onboarding-routes.ts`
- Modify: `src/api/app.ts`
- Test: `tests/google-calendar-onboarding-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/google-calendar-onboarding-routes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/google-calendar-onboarding-routes.test.ts
```

Expected: FAIL because the routes and buildApp option do not exist.

- [ ] **Step 3: Implement internal routes and app registration**

Add `createAuthorizationUrl` to `GoogleCalendarOnboardingService`:

```ts
createAuthorizationUrl(clinicId: string, returnPath: string): string {
  if (!this.options.oauthService) {
    throw new GoogleCalendarOnboardingError("google_calendar_oauth_not_configured");
  }
  return this.options.oauthService.createAuthorizationUrl(clinicId, { returnPath });
}
```

Extend `GoogleCalendarOnboardingError` with this code:

```ts
"google_calendar_oauth_not_configured"
```

Create `src/api/google-calendar-onboarding-routes.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  GoogleCalendarOnboardingError,
  type GoogleCalendarOnboardingService
} from "../application/onboarding/google-calendar-onboarding-service.js";

const clinicParamsSchema = z.object({ clinicId: z.string().min(1) });

export type GoogleCalendarOnboardingRoutesOptions = {
  adminToken: string;
  service: Pick<GoogleCalendarOnboardingService, "status" | "createAuthorizationUrl" | "listCalendars">;
};
```

Route behavior:

```ts
app.get("/internal/onboarding/clinics/:clinicId/google-calendar/status", async (request, reply) => {
  if (!isAuthorized(request.headers.authorization, options.adminToken)) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const params = clinicParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "invalid_clinic" });
  }
  return reply.send({ status: await options.service.status(params.data.clinicId) });
});
```

For start:

```ts
const returnPath = `/internal/onboarding/clinics/${encodeURIComponent(params.data.clinicId)}?googleCalendar=connected`;
return reply.send({
  authorizationUrl: options.service.createAuthorizationUrl(params.data.clinicId, returnPath)
});
```

For calendars, map errors:

```ts
if (error instanceof GoogleCalendarOnboardingError) {
  return reply.status(409).send({ error: error.code });
}
```

Duplicate the existing constant-time bearer token helpers from `src/api/onboarding-routes.ts` or extract them into a small shared auth helper in `src/api/internal-auth.ts` and update both route files in this same task.

Modify `src/api/app.ts`:

```ts
import {
  registerGoogleCalendarOnboardingRoutes,
  type GoogleCalendarOnboardingRoutesOptions
} from "./google-calendar-onboarding-routes.js";
```

Add to `BuildAppOptions`:

```ts
googleCalendarOnboarding?: GoogleCalendarOnboardingRoutesOptions;
```

Register:

```ts
if (options.googleCalendarOnboarding) {
  registerGoogleCalendarOnboardingRoutes(app, options.googleCalendarOnboarding);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/google-calendar-onboarding-routes.test.ts tests/onboarding-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/onboarding/google-calendar-onboarding-service.ts src/api/google-calendar-onboarding-routes.ts src/api/app.ts tests/google-calendar-onboarding-routes.test.ts tests/onboarding-routes.test.ts
git commit -m "feat: add google calendar onboarding routes"
```

## Task 5: Make Calendar Readiness Derived From Credentials And Mappings

**Files:**
- Modify: `src/application/onboarding/onboarding-service.ts`
- Modify: `src/application/onboarding/google-calendar-onboarding-service.ts`
- Test: `tests/onboarding-service.test.ts`
- Test: `tests/onboarding-routes.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Add to `tests/onboarding-service.test.ts`:

```ts
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import { GOOGLE_CALENDAR_SCOPES } from "../src/config/google-calendar.js";
```

Add test:

```ts
it("keeps calendar readiness missing until Google credentials and mapped professional calendars exist", async () => {
  const context = buildContext();
  const credentials = new InMemoryCalendarCredentialRepository();
  const service = new OnboardingService({
    onboarding: context.onboarding,
    operational: context.operational,
    calendarCredentials: credentials,
    calendarRequiredScopes: [...GOOGLE_CALENDAR_SCOPES],
    now: () => new Date("2026-06-01T12:00:00.000Z")
  });
  await service.createManualClinic({
    clinicId: "clinic_1",
    clinicName: "Clinica Demo",
    primaryContactName: "Ana Manager",
    primaryContactPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    source: "presencial",
    now: new Date("2026-06-01T12:00:00.000Z")
  });
  await service.updatePaymentStatus({ clinicId: "clinic_1", paymentStatus: "trial" });
  await service.updateReadinessFlags({
    clinicId: "clinic_1",
    whatsappReady: true,
    calendarConnected: true,
    testConversationPassed: true,
    activationChecklistCompleted: true
  });
  await service.saveClinicProfile({
    ...profile("clinic_1"),
    professionals: [{ ...profile("clinic_1").professionals[0], calendarId: "" }]
  });

  await expect(service.readiness("clinic_1")).resolves.toEqual({
    clinicId: "clinic_1",
    ready: false,
    missing: ["clinic_profile", "calendar"]
  });

  await credentials.save({
    clinicId: "clinic_1",
    provider: "google",
    scopes: [...GOOGLE_CALENDAR_SCOPES],
    accessToken: "access_token",
    refreshToken: "refresh_token"
  });
  await service.saveClinicProfile(profile("clinic_1"));

  await expect(service.readiness("clinic_1")).resolves.toEqual({
    clinicId: "clinic_1",
    ready: true,
    missing: []
  });
});
```

Add another test:

```ts
it("rejects duplicate professional calendar mappings in Google readiness mode", async () => {
  const context = buildContext();
  const credentials = new InMemoryCalendarCredentialRepository();
  const service = new OnboardingService({
    onboarding: context.onboarding,
    operational: context.operational,
    calendarCredentials: credentials,
    calendarRequiredScopes: [...GOOGLE_CALENDAR_SCOPES],
    now: () => new Date("2026-06-01T12:00:00.000Z")
  });
  await service.createManualClinic({
    clinicId: "clinic_1",
    clinicName: "Clinica Demo",
    primaryContactName: "Ana Manager",
    primaryContactPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    source: "presencial",
    now: new Date("2026-06-01T12:00:00.000Z")
  });
  await credentials.save({
    clinicId: "clinic_1",
    provider: "google",
    scopes: [...GOOGLE_CALENDAR_SCOPES],
    accessToken: "access_token",
    refreshToken: "refresh_token"
  });

  await service.saveClinicProfile({
    ...profile("clinic_1"),
    professionals: [
      { ...profile("clinic_1").professionals[0], id: "pro_perez", calendarId: "shared_calendar" },
      { ...profile("clinic_1").professionals[0], id: "pro_gomez", name: "Dra. Gomez", calendarId: "shared_calendar" }
    ],
    services: [
      { ...profile("clinic_1").services[0], professionalIds: ["pro_perez", "pro_gomez"] }
    ]
  });

  await expect(service.readiness("clinic_1")).resolves.toMatchObject({
    clinicId: "clinic_1",
    ready: false,
    missing: ["calendar"]
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/onboarding-service.test.ts tests/onboarding-routes.test.ts
```

Expected: FAIL because `OnboardingServiceOptions` does not accept calendar credential dependencies and readiness still trusts the manual flag.

- [ ] **Step 3: Implement derived readiness**

Modify `OnboardingServiceOptions`:

```ts
import type { CalendarCredentialRepository } from "../../ports/calendar-auth.js";
import {
  googleCalendarConnectionStatus,
  hasUsableProfessionalCalendarMappings
} from "./google-calendar-onboarding-service.js";

export type OnboardingServiceOptions = {
  onboarding: OnboardingRepository;
  operational: OperationalRepository;
  calendarCredentials?: CalendarCredentialRepository;
  calendarRequiredScopes?: string[];
  now?: () => Date;
};
```

In `readiness`, load credentials when configured:

```ts
const [setup, profile, googleCredentials] = await Promise.all([
  this.options.onboarding.getClinicSetup(clinicId),
  this.options.operational.getClinicProfile(clinicId),
  this.options.calendarCredentials?.get({ clinicId, provider: "google" })
]);
```

Replace the calendar missing check with:

```ts
const calendarOk = this.isCalendarReady(setup, profile, googleCredentials);
```

Add private helper:

```ts
private isCalendarReady(
  setup: ClinicSetupRecord | undefined,
  profile: ClinicProfile | undefined,
  googleCredentials: CalendarCredentials | undefined
): boolean {
  if (!this.options.calendarCredentials) {
    return Boolean(setup?.calendarConnected);
  }
  const status = googleCalendarConnectionStatus({
    credentials: googleCredentials,
    requiredScopes: this.options.calendarRequiredScopes ?? []
  });
  return status.connected && !status.reconnectRequired && hasUsableProfessionalCalendarMappings(profile);
}
```

Add `hasUsableProfessionalCalendarMappings` to `src/application/onboarding/google-calendar-onboarding-service.ts`:

```ts
export function hasUsableProfessionalCalendarMappings(profile: ClinicProfile | undefined): boolean {
  if (!profile) {
    return false;
  }
  const calendarIds = profile.professionals
    .map((professional) => professional.calendarId.trim())
    .filter((calendarId) => calendarId.length > 0);
  if (calendarIds.length === 0 || new Set(calendarIds).size !== calendarIds.length) {
    return false;
  }
  const mappedProfessionalIds = new Set(
    profile.professionals
      .filter((professional) => professional.calendarId.trim().length > 0)
      .map((professional) => professional.id)
  );
  return profile.services.every((service) =>
    service.professionalIds.some((professionalId) => mappedProfessionalIds.has(professionalId))
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/onboarding-service.test.ts tests/onboarding-routes.test.ts tests/google-calendar-onboarding-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/onboarding/onboarding-service.ts src/application/onboarding/google-calendar-onboarding-service.ts tests/onboarding-service.test.ts tests/onboarding-routes.test.ts tests/google-calendar-onboarding-service.test.ts
git commit -m "feat: derive calendar readiness from google mapping"
```

## Task 6: Wire Runtime Dependencies

**Files:**
- Modify: `src/runtime/server-runtime.ts`
- Modify: `src/server.ts`
- Test: `tests/server-runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add to `tests/server-runtime.test.ts`:

```ts
import { GOOGLE_CALENDAR_SCOPES } from "../src/config/google-calendar.js";

it("exposes Google Calendar onboarding dependencies from the Google runtime", async () => {
  const context = createPrismaTestContext("momentum-google-runtime-onboarding-");
  try {
    const runtime = await buildGoogleCalendarRuntime({
      prisma: context.prisma,
      env: googleRuntimeEnv()
    });

    expect(runtime.config.scopes).toEqual([...GOOGLE_CALENDAR_SCOPES]);
    expect(runtime.credentialRepository).toBeDefined();
    expect(runtime.createCalendarClient("clinic_runtime_onboarding")).toBeDefined();
  } finally {
    await context.cleanup();
  }
});
```

Add this helper near the bottom of `tests/server-runtime.test.ts`:

```ts
function googleRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/integrations/google-calendar/callback",
    GOOGLE_CALENDAR_SETUP_TOKEN: "google-setup-token",
    TOKEN_ENCRYPTION_KEY: "01".repeat(32)
  };
}
```

Update `FakeGoogleOAuthClient.getToken()` in `tests/server-runtime.test.ts` so the returned token fixture grants all required scopes:

```ts
scope: GOOGLE_CALENDAR_SCOPES.join(" ")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server-runtime.test.ts
```

Expected: FAIL because `config`, `credentialRepository`, and `createCalendarClient` are not returned from `buildGoogleCalendarRuntime`.

- [ ] **Step 3: Implement runtime wiring**

Update `buildGoogleCalendarRuntime` return object:

```ts
return {
  config,
  credentialRepository: credentials,
  setupToken: config.setupToken,
  oauthService: new GoogleOAuthService(config, credentials, input.googleOAuthClientFactory),
  createCalendarClient: (targetClinicId: string) =>
    new GoogleCalendarApiClient({
      clinicId: targetClinicId,
      credentialRepository: credentials,
      config
    }),
  calendar: new GoogleCalendarAdapter(client, { timezone })
};
```

Update `src/server.ts` when creating `OnboardingService`:

```ts
calendarCredentials: googleRuntime?.credentialRepository,
calendarRequiredScopes: googleRuntime?.config.scopes
```

Create Google onboarding service in `src/server.ts` when `adminConfig.enabled && googleRuntime`:

```ts
const googleCalendarOnboardingService =
  adminConfig.enabled && googleRuntime
    ? new GoogleCalendarOnboardingService({
        credentials: googleRuntime.credentialRepository,
        requiredScopes: googleRuntime.config.scopes,
        oauthService: googleRuntime.oauthService,
        calendarClientFactory: googleRuntime.createCalendarClient
      })
    : undefined;
```

Pass to `buildApp`:

```ts
googleCalendarOnboarding:
  adminConfig.enabled && googleCalendarOnboardingService
    ? { adminToken: adminConfig.token, service: googleCalendarOnboardingService }
    : undefined
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/server-runtime.test.ts tests/google-calendar-onboarding-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server-runtime.ts src/server.ts tests/server-runtime.test.ts
git commit -m "feat: wire google calendar onboarding runtime"
```

## Task 7: Add Web Onboarding Calendar UI

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`
- Test: `tests/web-api-proxy.test.ts`
- Test: `tests/web-activation-readiness.test.ts`

- [ ] **Step 1: Write failing web helper tests**

Add to `tests/web-api-proxy.test.ts` a proxy assertion for the new start endpoint using the existing `withBackendServer` helper:

```ts
it("proxies Google calendar onboarding start responses", async () => {
  const observed = await withBackendServer(async (baseUrl, requests) => {
    process.env.MOMENTUM_API_BASE_URL = baseUrl;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;

    const response = await POST(
      new Request("http://127.0.0.1:3001/api/backend/internal/onboarding/clinics/clinic_1/google-calendar/start", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }),
      {
        params: Promise.resolve({
          path: ["internal", "onboarding", "clinics", "clinic_1", "google-calendar", "start"]
        })
      }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    return requests[0];
  });

  expect(observed).toEqual({
    method: "POST",
    url: "/internal/onboarding/clinics/clinic_1/google-calendar/start",
    authorization: "Bearer secret",
    contentType: "application/json",
    ignoredHeader: undefined,
    body: "{}"
  });
});
```

- [ ] **Step 2: Run proxy test**

Run:

```bash
npm test -- tests/web-api-proxy.test.ts
```

Expected: PASS. The existing proxy already supports POST and nested path forwarding; this test locks that behavior before the UI depends on it.

- [ ] **Step 3: Add response types**

Update `apps/web/src/lib/types.ts`:

```ts
export type GoogleCalendarConnectionStatus = {
  provider: "google";
  connected: boolean;
  reconnectRequired: boolean;
  requiredScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
};

export type GoogleCalendarStatusResponse = {
  status: GoogleCalendarConnectionStatus;
};

export type GoogleCalendarStartResponse = {
  authorizationUrl: string;
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  bookable: boolean;
};

export type GoogleCalendarListResponse = {
  calendars: GoogleCalendarSummary[];
};
```

- [ ] **Step 4: Implement calendar panel state and API actions**

In `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`, import the new types and add state:

```ts
const [googleStatus, setGoogleStatus] = useState<GoogleCalendarConnectionStatus | null>(null);
const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarSummary[]>([]);
```

Add functions:

```ts
async function loadGoogleCalendarStatus() {
  const response = await apiJson<GoogleCalendarStatusResponse>(
    `/internal/onboarding/clinics/${clinicId}/google-calendar/status`,
    { headers: adminHeaders(token) }
  );
  setGoogleStatus(response.status);
}

async function connectGoogleCalendar() {
  setIsBusy(true);
  setStatus("Starting Google Calendar connection...");
  try {
    const response = await apiJson<GoogleCalendarStartResponse>(
      `/internal/onboarding/clinics/${clinicId}/google-calendar/start`,
      { method: "POST", headers: adminHeaders(token) }
    );
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to start Google Calendar connection.");
    setIsBusy(false);
  }
}

async function loadGoogleCalendars() {
  setIsBusy(true);
  setStatus("Loading Google calendars...");
  try {
    const response = await apiJson<GoogleCalendarListResponse>(
      `/internal/onboarding/clinics/${clinicId}/google-calendar/calendars`,
      { headers: adminHeaders(token) }
    );
    setGoogleCalendars(response.calendars);
    setStatus("Google calendars loaded.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to load Google calendars.");
  } finally {
    setIsBusy(false);
  }
}
```

Call `loadGoogleCalendarStatus()` at the end of `loadClinic()` after `setSetup(response.setup)`.

- [ ] **Step 5: Add profile JSON mapping helpers**

Add local types and helpers in the page file:

```ts
type EditableClinicProfile = {
  professionals?: Array<{ id: string; name: string; calendarId?: string }>;
  services?: Array<{ id: string; name: string; professionalIds: string[] }>;
};

function parseEditableProfile(value: string): EditableClinicProfile | undefined {
  try {
    const parsed = JSON.parse(value) as EditableClinicProfile;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function updateProfessionalCalendarId(profileJson: string, professionalId: string, calendarId: string): string {
  const parsed = JSON.parse(profileJson) as EditableClinicProfile;
  return JSON.stringify(
    {
      ...parsed,
      professionals: (parsed.professionals ?? []).map((professional) =>
        professional.id === professionalId ? { ...professional, calendarId } : professional
      )
    },
    null,
    2
  );
}
```

Use:

```ts
const parsedProfile = parseEditableProfile(profileJson);
const mappedCalendarIds = new Set(
  (parsedProfile?.professionals ?? [])
    .map((professional) => professional.calendarId ?? "")
    .filter(Boolean)
);
```

- [ ] **Step 6: Render the Calendar panel**

Add a panel before `Clinic profile JSON`:

```tsx
<div className="internal-panel internal-form">
  <div className="internal-panel-heading">
    <h2>Google Calendar</h2>
    {googleStatus ? <span>{googleStatus.connected ? "connected" : "not connected"}</span> : null}
  </div>
  <div className="internal-actions">
    <button className="primary-link" disabled={isBusy || !token} onClick={connectGoogleCalendar} type="button">
      {googleStatus?.connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
    </button>
    <button className="secondary-link button-like" disabled={isBusy || !token || !googleStatus?.connected || googleStatus.reconnectRequired} onClick={loadGoogleCalendars} type="button">
      Refresh calendars
    </button>
  </div>
  {googleStatus?.reconnectRequired ? (
    <p className="internal-empty">Reconnect Google Calendar to grant the required calendar-list permission.</p>
  ) : null}
  <div className="calendar-map">
    {(parsedProfile?.professionals ?? []).map((professional) => (
      <label key={professional.id}>
        {professional.name}
        <select
          value={professional.calendarId ?? ""}
          onChange={(event) => setProfileJson(updateProfessionalCalendarId(profileJson, professional.id, event.target.value))}
        >
          <option value="">Select calendar</option>
          {googleCalendars.map((calendar) => (
            <option
              disabled={!calendar.bookable || (calendar.id !== professional.calendarId && mappedCalendarIds.has(calendar.id))}
              key={calendar.id}
              value={calendar.id}
            >
              {calendar.summary} - {calendar.accessRole}
            </option>
          ))}
        </select>
      </label>
    ))}
  </div>
</div>
```

Keep the existing JSON editor visible so the operator can still edit services, pricing, preparation, restrictions, working hours, and patient fields.

- [ ] **Step 7: Remove normal manual calendar checkbox**

Change `readinessLabels` so it excludes `calendarConnected`:

```ts
const readinessLabels: Array<{ key: keyof Pick<
  ClinicSetupRecord,
  "whatsappReady" | "testConversationPassed" | "activationChecklistCompleted"
>; label: string }> = [
  { key: "whatsappReady", label: "WhatsApp ready" },
  { key: "testConversationPassed", label: "Test conversation passed" },
  { key: "activationChecklistCompleted", label: "Activation checklist completed" }
];
```

- [ ] **Step 8: Run web verification**

Run:

```bash
npm test -- tests/web-api-proxy.test.ts tests/web-activation-readiness.test.ts
npm --workspace apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/types.ts 'apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx' tests/web-api-proxy.test.ts tests/web-activation-readiness.test.ts
git commit -m "feat: add google calendar onboarding ui"
```

## Task 8: Update Documentation And Run Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README Google setup instructions**

Replace the manual seeded calendar-id step with:

````md
4. Start the API with admin onboarding enabled:

```bash
CALENDAR_PROVIDER=google MOMENTUM_ADMIN_TOKEN="local-admin-token" ENABLE_SIMULATION_API=true npm run dev:api
```

5. Start the web app:

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000" npm run dev:web
```

6. Open `http://127.0.0.1:3001/internal/onboarding`, enter `local-admin-token`, open the clinic setup page, and use the Google Calendar panel to connect Google and map each professional to a writable calendar.
7. Save the clinic profile.
8. Use test mode or `/simulate/inbound-message` to request, confirm, reschedule, or cancel a booking.
9. Verify the event appears, moves, or disappears in the mapped Google Calendar.
````

Update required scopes to include:

```md
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
```

- [ ] **Step 2: Run focused backend verification**

Run:

```bash
npm test -- tests/google-calendar-onboarding-service.test.ts tests/google-calendar-client.test.ts tests/google-calendar-onboarding-routes.test.ts tests/google-oauth.test.ts tests/onboarding-service.test.ts tests/server-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test -- --run
npx prisma validate
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
git diff --check
```

Expected:

- TypeScript exits with code 0.
- Vitest reports all tests passing.
- Prisma schema validates.
- Next web typecheck and build pass.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update google calendar onboarding setup"
```

## Final Review

- [ ] Confirm `git status --short` is clean.
- [ ] Confirm the final commit stack is small and scoped.
- [ ] Confirm no production path exposes the internal admin token in a URL.
- [ ] Confirm calendar discovery is only available through protected internal routes.
- [ ] Confirm `calendarConnected` is not manually toggled in the normal web onboarding UI.
- [ ] Confirm activation readiness returns missing `calendar` without credentials or valid mappings.
