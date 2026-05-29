# Google Calendar Integration Mini PRD

Date: 2026-05-29
Status: Draft for user review

## Summary

This block connects Momentum to real Google Calendar before real WhatsApp.

Google Calendar becomes the live source of truth for availability and appointment events. Momentum keeps the appointment workflow it already has, but replaces the fake calendar adapter with a Google Calendar adapter behind the existing `CalendarPort`.

## Goal

Let Momentum read real professional availability from Google Calendar and create, reschedule, and cancel real calendar events.

The first end-to-end proof can still use the local WhatsApp-style simulation API. The important change is that bookings are written to a real Google Calendar.

## Recommended Approach

Use Google OAuth 2.0 user consent with offline access.

Why:
- Most clinics will not have Google Workspace admin/domain-wide delegation configured.
- Service accounts are poor fit for small clinics unless the clinic has Workspace admin setup.
- OAuth lets the clinic connect the account that already has access to the professionals' calendars.

Momentum should request the narrowest useful scopes:
- `https://www.googleapis.com/auth/calendar.events` for creating, updating, deleting, and reading appointment events.
- `https://www.googleapis.com/auth/calendar.events.freebusy` for availability checks.

## Calendar Model

MVP model:
- One Google calendar per professional.
- Each service maps to one or more professionals.
- Each professional has working hours in Momentum config.
- Google Calendar events block availability.
- Momentum creates appointment events in the selected professional's Google calendar.

Important distinction:
- Google Calendar is the source of truth for busy/blocked time.
- Momentum config is the source of truth for bookable working windows.

Without professional working windows, FreeBusy only tells Momentum what is occupied, not what should be offered.

## Required Capabilities

OAuth and connection:
- Generate a clinic-specific Google OAuth start URL.
- Handle Google OAuth callback.
- Store refresh token and token expiry securely.
- Reuse and refresh access tokens automatically.
- Support one connected Google account for the first clinic.
- Support multiple professional calendars under that account.

Availability:
- Generate candidate appointment slots from professional working hours.
- Query Google FreeBusy for matching calendars.
- Remove busy intervals from candidate slots.
- Respect service duration, buffers, minimum notice, and requested professional.
- Return slots sorted by earliest time.

Booking:
- Re-check Google Calendar before creating an event.
- Create a Google Calendar event with summary, start, end, timezone, and private Momentum metadata.
- Store the returned Google event id as `calendarEventId`.
- Run a post-create overlap check; if a conflicting event appeared, delete the Momentum event and fail gracefully.

Rescheduling:
- Re-check availability for the replacement time.
- Update the existing Google Calendar event.
- Keep the same local appointment id and calendar event id.

Cancellation:
- Delete the Google Calendar event, or treat a Google 404 as already cancelled.
- Mark the Momentum appointment cancelled locally.

Error handling:
- Missing Google connection should fail clearly.
- Token refresh failure should require reconnect.
- Google rate limits or 5xx errors should surface as retryable infrastructure errors.
- Slot conflicts should surface as `CalendarAvailabilityError` so the existing workflow can offer another slot.

## Out of Scope

This block does not include:
- Outlook.
- Real WhatsApp/Kapso.
- Google Calendar push notifications/watch channels.
- Full customer dashboard.
- Automatic calendar discovery UI.
- Rooms, cabins, devices, or shared resources.
- Google appointment schedules.
- Multi-location clinic rules.

## Data Flow

1. Clinic connects Google Calendar through OAuth.
2. Momentum stores encrypted OAuth tokens for the clinic.
3. Professional config maps each professional to a Google calendar id and working hours.
4. Patient asks for a turn through the current local simulation API.
5. `SchedulingService` calls `CalendarPort.findFreeSlots()`.
6. `GoogleCalendarAdapter` generates working-hour slots and subtracts Google FreeBusy busy intervals.
7. Patient confirms.
8. `SchedulingService` calls `CalendarPort.createEvent()`.
9. `GoogleCalendarAdapter` creates the event in the professional's Google calendar.
10. Momentum stores the Google event id and confirms.

## Acceptance Criteria

- Local tests still pass with `FakeCalendar`.
- A Google adapter test proves FreeBusy busy intervals are excluded from generated slots.
- A Google adapter test proves event creation maps Momentum metadata into Google private extended properties.
- A Google adapter test proves update and delete map to Google Calendar event update/delete.
- OAuth routes can generate a Google authorization URL and accept a callback in local dev.
- A manual smoke test can book one appointment into a real Google calendar through `/simulate/inbound-message`.
- No scheduling application code imports Google-specific modules directly.

## Sources

- Google Calendar API scopes: https://developers.google.com/workspace/calendar/api/auth
- Google Calendar Node.js quickstart: https://developers.google.com/workspace/calendar/api/quickstart/nodejs
- FreeBusy query: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Events insert: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- Events update: https://developers.google.com/workspace/calendar/api/v3/reference/events/update
- Events delete: https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
