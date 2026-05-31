# Live Pilot Activation & Production Readiness Design

Date: 2026-05-31
Status: Approved for implementation planning

## Summary

Momentum has the core MVP pieces working locally: onboarding, Google Calendar mapping, WhatsApp/Kapso integration, conversational booking, persistence, outbound automations, and activation gates.

This block turns that local MVP into a real 24/7 pilot that can be tested with a clinic and real patients. The goal is not to add major product scope. The goal is to make production operation reliable enough to activate one clinic safely.

## Goals

- Deploy Momentum as a stable pilot environment reachable from the public internet.
- Use Postgres managed in production and keep SQLite only for local development.
- Run the public landing, private onboarding, API routes, WhatsApp webhooks, and outbound cron from a simple production setup.
- Connect a real WhatsApp/Kapso number dedicated to Momentum or formally migrated to API usage.
- Connect Google Calendar OAuth in production and keep Google Calendar as the source of truth.
- Fail closed when production prerequisites are missing.
- Add a clear go-live checklist and smoke test for the first clinic.
- Add enough logs, health checks, and documentation to operate the pilot without guessing.

## Non-Goals

- No Outlook.
- No payments or subscription billing.
- No customer-facing dashboard.
- No staff/internal WhatsApp agent.
- No advanced analytics dashboard.
- No multi-location onboarding.
- No replacement of Kapso with direct Meta Cloud API unless Kapso blocks the pilot.
- No broad infrastructure abstraction before a real limitation appears.

## Recommended Production Shape

Start with a simple Vercel-first deployment:

- Next.js web app on Vercel.
- Backend API and webhook routes deployed in the same project if route/runtime constraints remain compatible.
- Vercel Cron for outbound automation HTTP triggers.
- Managed Postgres through a current Vercel Marketplace-compatible provider, such as Neon/Postgres.
- Production environment variables configured in Vercel.

If Vercel Functions or Cron become a real constraint for webhook reliability, long-running work, or background jobs, split the backend into a separate service. Do not split upfront.

## Production Database

Production must use managed Postgres.

SQLite remains the local development default. Production should reject startup when a production runtime is configured with a local SQLite URL.

The implementation should support Prisma against Postgres without breaking local SQLite development. Any schema changes needed for provider compatibility should be tested through Prisma validation and at least one production-like migration path.

## WhatsApp Pilot Model

The first pilot should use:

- a dedicated WhatsApp number, or
- a number formally migrated/registered for API usage through the selected provider.

Do not assume the same number can be used casually by WhatsApp Business App and the API at the same time.

Kapso remains the preferred provider for this block because the adapter already exists. The production setup must document:

- required Kapso credentials;
- webhook URL;
- webhook signature secret;
- phone number id;
- business account id;
- expected inbound event type;
- how to send a real test message;
- how to pause production if needed.

## Google Calendar Production Model

Google Calendar stays the source of truth.

Production setup must require:

- Google OAuth client configured for the production callback URL;
- event, freebusy, and calendar-list scopes;
- encrypted token storage;
- one connected clinic account with writer or owner access to every professional calendar;
- one writable calendar per bookable professional for the MVP.

Activation must fail when credentials are missing, scopes are incomplete, calendars are unmapped, or mappings are invalid.

## Activation Gates

Production patient automation may run only when all are true:

- clinic lifecycle state is `active`;
- payment status is `paid`, `trial`, or `waived`;
- valid clinic profile exists;
- Google Calendar connection and mappings are valid;
- WhatsApp/Kapso production config exists;
- activation checklist is complete;
- test conversation passed;
- runtime is not in simulation-only mode.

If any prerequisite is missing, the production webhook should fail closed with no patient-facing side effects beyond a safe logged rejection.

## Outbound Automation

Outbound automation remains limited to:

- appointment reminders;
- warm lead reactivation;
- freed-slot offers.

For production, each cron run should:

- require an internal token;
- respect opt-out;
- respect quiet hours;
- use durable delivery keys;
- audit attempted, sent, skipped, and failed sends;
- be safe to retry.

Cron scheduling should be documented in UTC. Business quiet-hour logic remains clinic-timezone aware.

## Handoff And Pause

The first production handoff model remains simple:

- patient asks for a human or the agent detects a handoff condition;
- Momentum pauses the bot for that conversation;
- Momentum logs/audits the handoff;
- the team or clinic handles the conversation in the provider-supported operational surface.

The pilot does not need a full human inbox. It does need a reliable way to pause/resume bot behavior and a documented operational process.

## Observability

Add minimum production observability:

- health endpoint for deployment checks;
- startup config summary that reports enabled providers without leaking secrets;
- structured logs for inbound webhook received, duplicate skipped, workflow result, outbound send, calendar action, handoff, activation, and critical errors;
- audit events for booking, reschedule, cancellation, outbound, handoff, activation, and pause/resume.

Do not add a full observability platform unless needed. The first target is enough signal to debug the first pilot quickly.

## Smoke Test

A clinic is not considered live until this smoke test passes:

1. Deploy production environment.
2. Run database migration.
3. Open public landing.
4. Open private onboarding.
5. Create or load a clinic.
6. Fill services, professionals, prices, durations, preparation, restrictions, and agenda rules.
7. Connect Google Calendar.
8. Map each professional to a writable calendar.
9. Configure WhatsApp/Kapso webhook.
10. Pass internal test mode.
11. Activate the clinic.
12. Send a real WhatsApp message.
13. Book a real appointment.
14. Verify the Google Calendar event exists.
15. Reschedule the appointment.
16. Verify the Google Calendar event moved.
17. Cancel the appointment.
18. Verify the Google Calendar event was cancelled/deleted as designed.
19. Run outbound automation manually with no due messages and verify safe no-op.
20. Run one controlled due outbound case and verify delivery/audit.
21. Confirm `git` build, typecheck, Prisma validation, and tests pass from the deployed code revision.

## Runbook

The implementation should produce a concise runbook covering:

- required accounts;
- required environment variables;
- database setup and migration;
- Vercel deployment steps;
- Google OAuth callback configuration;
- Kapso webhook configuration;
- clinic activation checklist;
- smoke test checklist;
- emergency pause;
- common failure modes and fixes.

## Acceptance Criteria

- Production deployment can start without local-only simulation assumptions.
- Production refuses unsafe SQLite/local configuration.
- Prisma is valid for the production database provider.
- Vercel deployment configuration includes required API/webhook and cron behavior.
- A real clinic can be activated only after calendar, WhatsApp, checklist, payment, and test gates pass.
- A real WhatsApp inbound message can create, reschedule, and cancel a Google Calendar appointment.
- Outbound automation can run from a protected production cron/manual trigger.
- Logs and audit records make the first pilot debuggable.
- README/runbook explain how to deploy and test the pilot end-to-end.

## Sources

- Vercel Functions: https://vercel.com/docs/functions
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Postgres on Vercel: https://vercel.com/docs/postgres
- Google Calendar API authorization scopes: https://developers.google.com/workspace/calendar/api/auth
- Google Calendar FreeBusy: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google Calendar Events: https://developers.google.com/workspace/calendar/api/v3/reference/events
