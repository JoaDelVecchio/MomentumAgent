# Google Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local fake calendar edge with a real Google Calendar adapter while preserving Momentum's existing scheduling workflows.

**Architecture:** Keep `SchedulingService` dependent only on `CalendarPort`. Add professional working-hour config, OAuth credential storage, and a Google adapter that uses FreeBusy plus Events APIs. Keep `FakeCalendar` for deterministic tests and local fallback.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Zod, Vitest, Prisma SQLite, `googleapis`.

---

## Scope Check

This plan implements Google Calendar only:
- OAuth connect/callback for one clinic account.
- Encrypted token storage.
- Professional working hours.
- Google FreeBusy availability.
- Google event create/update/delete.
- Local simulation API using Google calendar when configured.

It does not implement WhatsApp/Kapso, Outlook, OpenAI interpretation, dashboard UI, production deployment, or Google push notifications.

## File Structure

- `package.json`: add `googleapis`.
- `src/domain/types.ts`: add professional working hours types.
- `src/domain/clinic-profile.ts`: validate working hours.
- `src/application/scheduling/slot-generator.ts`: pure local-time working-window candidate slot generation.
- `src/ports/calendar.ts`: carry provider-neutral availability context to real calendar adapters.
- `src/ports/calendar-auth.ts`: provider-neutral calendar credential repository/vault interfaces.
- `src/adapters/memory/calendar-auth-repository.ts`: in-memory credentials for tests.
- `src/adapters/prisma/calendar-auth-repository.ts`: SQLite-backed encrypted credential persistence.
- `src/adapters/google/google-oauth.ts`: Google OAuth URL and callback token exchange.
- `src/adapters/google/google-calendar-client.ts`: narrow Google client wrapper used by the adapter.
- `src/adapters/google/google-calendar-adapter.ts`: implements `CalendarPort`.
- `src/api/google-calendar-routes.ts`: OAuth start/callback routes.
- `src/config/google-calendar.ts`: env parsing.
- `src/dev/seed.ts`: add working hours and optional Google calendar provider wiring.
- `prisma/schema.prisma`: add calendar connection/token model.
- `.env.example`: add Google OAuth/env vars.
- `README.md`: document local setup and smoke test.
- `tests/slot-generator.test.ts`: pure working-hours slot tests.
- `tests/google-calendar-adapter.test.ts`: mocked Google adapter tests.
- `tests/google-oauth.test.ts`: OAuth URL/callback and token persistence tests.
- `tests/simulation-api.test.ts`: ensure simulation remains compatible.

## Task 1: Add Professional Working Hours and Slot Generation

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/clinic-profile.ts`
- Create: `src/application/scheduling/slot-generator.ts`
- Modify: `src/ports/calendar.ts`
- Modify: `src/application/scheduling/scheduling-service.ts`
- Modify: `src/dev/seed.ts`
- Test: `tests/slot-generator.test.ts`
- Test: `tests/clinic-profile.test.ts`

- [ ] **Step 1: Write failing working-hours tests**

Create `tests/slot-generator.test.ts` covering:
- Monday working window `09:00-12:00` in `America/Argentina/Buenos_Aires` produces UTC slots for a 30-minute duration.
- Busy interval removes overlapping candidate slots.
- Buffer minutes are included in the blocked candidate duration.
- Empty working hours produce no slots.

Extend `tests/clinic-profile.test.ts` covering:
- professional working hours require valid day of week, `HH:mm` start, `HH:mm` end.
- end time must be after start time.

Run:

```bash
npm test -- tests/slot-generator.test.ts tests/clinic-profile.test.ts
```

Expected: FAIL because working-hour types and slot generator do not exist.

- [ ] **Step 2: Implement working-hour domain and generator**

Add:
- `WorkingDay = 0 | 1 | 2 | 3 | 4 | 5 | 6`
- `WorkingWindow = { day: WorkingDay; startTime: string; endTime: string }`
- `Professional.workingHours: WorkingWindow[]`
- `FindFreeSlotsInput.availabilityContext` containing timezone, compatible professionals, service duration, and buffer.

Implement `generateWorkingHourSlots(input)` in `src/application/scheduling/slot-generator.ts`.

Use UTC `Date` internally and the clinic/professional IANA timezone for interpreting local working hours.

Update `SchedulingService` to pass `availabilityContext` whenever it calls `CalendarPort.findFreeSlots()`, so Google Calendar can combine Momentum's working-hour rules with Google FreeBusy busy intervals without importing scheduling/domain services.

- [ ] **Step 3: Update seed and verification**

Update seeded professionals with Monday-Friday working hours.

Run:

```bash
npm test -- tests/slot-generator.test.ts tests/clinic-profile.test.ts tests/scheduling-service.test.ts tests/simulation-api.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/domain/types.ts src/domain/clinic-profile.ts src/application/scheduling/slot-generator.ts src/ports/calendar.ts src/application/scheduling/scheduling-service.ts src/dev/seed.ts tests/slot-generator.test.ts tests/clinic-profile.test.ts tests/scheduling-service.test.ts
git commit -m "feat: add professional working hours"
```

## Task 2: Add Calendar Credential Storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/ports/calendar-auth.ts`
- Create: `src/adapters/memory/calendar-auth-repository.ts`
- Create: `src/adapters/prisma/calendar-auth-repository.ts`
- Test: `tests/google-oauth.test.ts`

- [ ] **Step 1: Write failing credential tests**

Create `tests/google-oauth.test.ts` covering:
- credential repository saves and reads a Google refresh token by `clinicId`.
- encrypted repository storage does not expose the raw refresh token string.
- missing credentials return `undefined`.

Run:

```bash
npm test -- tests/google-oauth.test.ts
```

Expected: FAIL because credential repositories do not exist.

- [ ] **Step 2: Add Prisma model and repository ports**

Add `CalendarConnection` model with:
- `id`
- `clinicId`
- `provider`
- `providerAccountEmail`
- `scopesJson`
- `encryptedAccessToken`
- `encryptedRefreshToken`
- `expiryDate`
- timestamps

Add `CalendarCredentialRepository` and `TokenCipher` interfaces.

Implement:
- in-memory repository for tests;
- Prisma repository for local persistence;
- AES-256-GCM token cipher using `TOKEN_ENCRYPTION_KEY`.

- [ ] **Step 3: Migrate and verify**

Run:

```bash
npx prisma migrate dev --name add_calendar_connections
npm test -- tests/google-oauth.test.ts
npm run typecheck
```

Expected: migration succeeds, tests pass, typecheck passes.

Commit:

```bash
git add prisma/schema.prisma prisma/migrations src/ports/calendar-auth.ts src/adapters/memory/calendar-auth-repository.ts src/adapters/prisma/calendar-auth-repository.ts tests/google-oauth.test.ts
git commit -m "feat: add calendar credential storage"
```

## Task 3: Add Google OAuth Routes

**Files:**
- Modify: `package.json`
- Create: `src/config/google-calendar.ts`
- Create: `src/adapters/google/google-oauth.ts`
- Create: `src/api/google-calendar-routes.ts`
- Modify: `src/api/app.ts`
- Test: `tests/google-oauth.test.ts`

- [ ] **Step 1: Install Google client**

Run:

```bash
npm install googleapis
```

Expected: `package.json` and `package-lock.json` include `googleapis`.

- [ ] **Step 2: Write failing OAuth route tests**

Extend `tests/google-oauth.test.ts` covering:
- OAuth start URL includes client id, redirect URI, offline access, prompt consent, state containing clinic id, and the two approved scopes.
- callback exchanges `code` for tokens and stores them.
- invalid state returns 400.

Run:

```bash
npm test -- tests/google-oauth.test.ts
```

Expected: FAIL because OAuth implementation does not exist.

- [ ] **Step 3: Implement OAuth config, service, and routes**

Implement:
- `readGoogleCalendarConfig(process.env)`.
- `GoogleOAuthService.createAuthorizationUrl(clinicId)`.
- `GoogleOAuthService.handleCallback(code, state)`.
- `registerGoogleCalendarRoutes()` with:
  - `GET /integrations/google-calendar/start?clinicId=...`
  - `GET /integrations/google-calendar/callback?code=...&state=...`

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/google-oauth.test.ts tests/health.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add package.json package-lock.json src/config/google-calendar.ts src/adapters/google/google-oauth.ts src/api/google-calendar-routes.ts src/api/app.ts tests/google-oauth.test.ts
git commit -m "feat: add google calendar oauth flow"
```

## Task 4: Add Google Calendar Client and Adapter

**Files:**
- Create: `src/adapters/google/google-calendar-client.ts`
- Create: `src/adapters/google/google-calendar-adapter.ts`
- Test: `tests/google-calendar-adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/google-calendar-adapter.test.ts` covering:
- `findFreeSlots()` calls FreeBusy with all requested calendar ids and removes busy intervals.
- `createEvent()` re-checks availability before insert.
- `createEvent()` inserts summary, start/end, timezone, and `extendedProperties.private`.
- `createEvent()` deletes the inserted event and throws `CalendarAvailabilityError` if post-create overlap check detects conflict.
- `updateEvent()` checks replacement availability and updates the Google event.
- `cancelEvent()` calls delete and treats 404 as already cancelled.

Run:

```bash
npm test -- tests/google-calendar-adapter.test.ts
```

Expected: FAIL because Google client and adapter do not exist.

- [ ] **Step 2: Implement narrow Google client wrapper**

Implement a wrapper around `googleapis` with methods:
- `queryFreeBusy(calendarIds, from, to)`
- `listEvents(calendarId, from, to)`
- `insertEvent(calendarId, event)`
- `updateEvent(calendarId, eventId, event)`
- `deleteEvent(calendarId, eventId)`

The wrapper must refresh tokens through the stored OAuth credentials before calls.

- [ ] **Step 3: Implement `GoogleCalendarAdapter`**

Use professional working hours by calendar id to generate candidate slots.

Map:
- FreeBusy busy blocks to slot exclusion.
- Momentum metadata to Google `extendedProperties.private`.
- Google event id to `CalendarEvent.id`.
- Google 409/overlap conditions to `CalendarAvailabilityError`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/google-calendar-adapter.test.ts tests/fake-calendar.test.ts tests/scheduling-service.test.ts
npm run typecheck
```

Expected: adapter tests, existing calendar tests, scheduling tests, and typecheck pass.

Commit:

```bash
git add src/adapters/google/google-calendar-client.ts src/adapters/google/google-calendar-adapter.ts tests/google-calendar-adapter.test.ts
git commit -m "feat: add google calendar adapter"
```

## Task 5: Wire Google Calendar Into Local Runtime

**Files:**
- Modify: `src/dev/seed.ts`
- Modify: `src/server.ts`
- Modify: `src/api/app.ts`
- Test: `tests/simulation-api.test.ts`

- [ ] **Step 1: Write failing runtime wiring tests**

Extend `tests/simulation-api.test.ts` covering:
- simulation API still uses fake calendar by default.
- when `CALENDAR_PROVIDER=google` dependencies are injected, booking routes call the Google-backed `CalendarPort`.
- missing Google credentials returns a clear infrastructure error instead of silently using fake calendar.

Run:

```bash
npm test -- tests/simulation-api.test.ts
```

Expected: FAIL because provider selection does not exist.

- [ ] **Step 2: Implement provider selection**

Add runtime selection:
- default: fake calendar;
- `CALENDAR_PROVIDER=google`: build Google credential repository, Google client, and `GoogleCalendarAdapter`;
- preserve explicit test injection.

Do not remove the simulation API; it remains the fastest way to smoke-test booking before WhatsApp is real.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/simulation-api.test.ts tests/health.test.ts tests/google-calendar-adapter.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/dev/seed.ts src/server.ts src/api/app.ts tests/simulation-api.test.ts
git commit -m "feat: wire google calendar provider"
```

## Task 6: Document Setup and Run Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document env vars**

Add:
- `CALENDAR_PROVIDER=google`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `TOKEN_ENCRYPTION_KEY`
- `DATABASE_URL`

- [ ] **Step 2: Document local smoke test**

Add README steps:
- create Google Cloud OAuth client;
- set redirect URI;
- start Momentum locally;
- open `/integrations/google-calendar/start?clinicId=clinic_1`;
- complete OAuth;
- set a seeded professional `calendarId` to a real Google calendar id;
- send `/simulate/inbound-message`;
- verify a real event appears in Google Calendar;
- cancel/reschedule through simulation and verify the event changes.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test -- --run
npm run typecheck
npx prisma validate
git status --short
```

Expected:
- all tests pass;
- typecheck passes;
- Prisma schema validates;
- git status only shows intended docs before commit.

- [ ] **Step 4: Commit docs**

```bash
git add .env.example README.md
git commit -m "docs: add google calendar setup"
```

## Plan Self-Review

- Spec coverage: OAuth, credentials, working hours, FreeBusy availability, event create/update/delete, runtime wiring, and docs are covered.
- Scope check: WhatsApp/Kapso and Outlook remain separate blocks.
- Risk called out: Google Calendar does not provide bookable working windows; Momentum config must provide them.
- No scheduling application code should import Google-specific modules; only adapters/routes/config do.
