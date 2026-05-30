# Google Calendar Onboarding Mapping Design

Date: 2026-05-30
Status: Approved for implementation planning

## Summary

Momentum already has a Google Calendar OAuth backend and a Google-backed calendar adapter, but clinic onboarding still treats calendar readiness as a manual checkbox and stores professional calendar ids through raw profile JSON.

This block turns Google Calendar setup into a real private onboarding workflow: connect Google, list available calendars, map each bookable professional to a real writable calendar, save the clinic profile, and make activation readiness depend on the real connection and mapping instead of manual calendar flags.

## Goals

- Let the Momentum team connect a clinic's Google Calendar from the private onboarding screen.
- Discover calendars available to the connected Google account.
- Map every bookable professional to a real Google calendar.
- Keep Google Calendar as the source of truth for busy time and appointment events.
- Remove manual `calendarConnected` toggling from the normal activation path.
- Make activation readiness honest: a clinic is calendar-ready only when Google credentials exist and the operational profile contains usable professional calendar mappings.
- Preserve the current Google booking/rescheduling/cancellation adapter behavior.

## Non-Goals

- No Outlook in this block.
- No customer-facing dashboard.
- No public self-serve calendar connection.
- No rooms, cabins, devices, or resource calendars as first-class entities.
- No parsing employee names from event titles in one shared calendar.
- No Google Workspace domain-wide delegation.
- No Google Calendar push notifications or watch channels.
- No automatic creation of calendars in the clinic's Google account.

## Recommended Approach

Use one Google OAuth connection per clinic. The connected account should be a clinic owner, receptionist, or shared operations account that has write access to every professional calendar Momentum can book.

Use one Google calendar per bookable professional. This is the clearest model for multi-professional scheduling because two professionals can be free or busy independently. The existing data model already stores `Professional.calendarId`, and the scheduling engine already checks availability per professional calendar.

Do not support multiple professionals pointing to the same calendar in this block. A shared calendar would make all mapped professionals share the same busy timeline, which can wrongly prevent parallel appointments. If a clinic only has one shared agenda today, onboarding should either map it to one general professional/resource or help the clinic create/share separate professional calendars.

## OAuth Scopes

Keep the existing event and free/busy scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.events.freebusy`

Add the narrow calendar-list scope:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

Rationale: Google Calendar's `CalendarList.list` endpoint can list the user's calendars with `calendar.calendarlist.readonly`, which is narrower than full calendar read access. Momentum only needs the list of calendars for onboarding selection; it does not need to read all calendar event details through this scope.

Existing Google connections created before this scope was added must reconnect before calendar discovery works.

## Operator Workflow

1. Operator opens `/internal/onboarding/clinics/:clinicId`.
2. Operator enters the internal admin token and loads the clinic.
3. Calendar panel shows one of these states:
   - not connected;
   - connected but missing calendar-list scope;
   - connected and ready to list calendars.
4. Operator clicks `Connect Google Calendar`.
5. Momentum starts Google OAuth and returns the operator to the clinic onboarding page after consent.
6. Operator clicks `Refresh calendars` or the page loads calendars automatically.
7. Momentum lists calendars the connected account can access and marks which ones are bookable.
8. Operator maps each professional in the current clinic profile to one writable calendar.
9. Operator saves the clinic profile.
10. Activation readiness reports calendar ready only when credentials and mappings are valid.

## Calendar Discovery

The Google Calendar client should expose a `listCalendars` capability returning only metadata needed for onboarding:

- `id`;
- `summary`;
- `primary`;
- `accessRole`;
- `timeZone` when available;
- `bookable`, true only for `writer` or `owner` access.

The onboarding API should allow the UI to display non-bookable calendars for context, but it must not allow saving a professional mapping to a calendar that the connected account cannot write to.

Calendar discovery should handle pagination. Deleted calendars should not be shown. Hidden calendars can be included only if the Google API returns them through the configured request; the UI should avoid promising that every hidden calendar will appear.

## Backend API

Add internal calendar onboarding endpoints protected by the same admin token used by private onboarding:

- `GET /internal/onboarding/clinics/:clinicId/google-calendar/status`
  - returns whether credentials exist, whether required scopes are present, and whether reconnect is required.

- `POST /internal/onboarding/clinics/:clinicId/google-calendar/start`
  - returns `{ authorizationUrl }` for the authenticated operator.
  - avoids putting the internal admin token in a browser navigation URL.
  - includes a signed return path back to the web onboarding page after callback.

- `GET /internal/onboarding/clinics/:clinicId/google-calendar/calendars`
  - returns discovered calendars after validating admin auth and clinic existence.
  - returns a clear conflict if credentials are missing or scopes are insufficient.

Keep the existing public OAuth callback route, but improve the callback experience:

- default behavior can remain JSON for API compatibility;
- when the OAuth state contains an allowed internal return path, redirect back to the onboarding page with a connection status query parameter.

## Readiness Rules

`calendarConnected` should become a derived or synchronized readiness state, not a manual operator checkbox.

A clinic is calendar-ready when all are true:

- Google credentials exist for the clinic;
- stored credentials include all required scopes;
- the clinic profile exists;
- the profile has at least one professional with a non-empty `calendarId`;
- every bookable service has at least one professional with a mapped calendar;
- mapped calendars are unique per professional in this MVP.

Activation should rely on the backend readiness calculation, not on a stale UI flag alone.

The setup record can still expose `calendarConnected` for display, but onboarding should update it automatically after profile save and calendar connection checks. The UI should not offer a normal manual checkbox for `calendarConnected`.

## Frontend Design

The private clinic onboarding page should add a dedicated Calendar panel:

- connection status;
- `Connect Google Calendar` button;
- `Reconnect Google Calendar` button when scopes are missing;
- `Refresh calendars` action;
- calendar list with access role and bookable status.

The existing profile JSON editor can remain for this block, but calendar mapping should not require manually typing ids. Instead:

- parse professionals from the current profile JSON;
- show one row per professional;
- provide a calendar select for each professional;
- when the operator selects a calendar, update that professional's `calendarId` in the JSON;
- prevent duplicate calendar selection across professionals in this MVP;
- show a clear warning if a service points to a professional without a mapped calendar.

This keeps scope narrow while making the critical calendar setup feel like a real product flow.

## Error Handling

- Missing credentials: show "Connect Google Calendar".
- Missing new calendar-list scope: show "Reconnect Google Calendar".
- No writable calendars: explain that the connected account needs writer or owner access to the professional calendars.
- Google API failure: show a retryable error and do not mark calendar readiness.
- Invalid profile JSON: do not attempt calendar mapping save.
- Duplicate professional calendar mappings: block save for this block.
- Calendar id removed from Google after mapping: readiness should fail on the next calendar check or activation attempt.

## Data Model

No new persistent table is required for professional-calendar mapping. Use the existing `Professional.calendarId` field stored through the operational clinic profile.

Use the existing `CalendarConnection` persistence for Google OAuth credentials and scopes.

The implementation may add service-level interfaces for credential status and calendar discovery, but scheduling application code must continue to depend on `CalendarPort`, not Google-specific modules.

## Acceptance Criteria

- A clinic can start Google OAuth from the private onboarding UI.
- After consent, the operator can return to the same clinic onboarding page.
- The backend can list Google calendars using stored clinic credentials.
- The UI can map each professional to a writable Google calendar without manual id typing.
- Profile save persists selected calendar ids.
- Activation readiness reports missing `calendar` until real credentials and valid mappings exist.
- The regular booking/rescheduling/cancellation tests still pass with fake and Google calendar adapters.
- Existing local Google setup documentation no longer requires editing `src/dev/seed.ts` for calendar ids.

## Sources

- Google Calendar API scopes: https://developers.google.com/workspace/calendar/api/auth
- Google Calendar CalendarList.list: https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
