# Live Pilot Runbook

## Purpose

Use this runbook to deploy and activate the first real Momentum clinic pilot.

## Required Accounts

- Vercel API project rooted at the repository root.
- Vercel web project rooted at `apps/web`.
- Managed Postgres through Vercel Marketplace, preferably Neon/Postgres.
- Kapso account with a dedicated or formally migrated WhatsApp API number.
- Google Cloud OAuth client for Calendar API.
- OpenAI API key if `AI_INTERPRETER_PROVIDER=openai` is used.

## Required Production Environment

Set these in Vercel production:

```bash
MOMENTUM_RUNTIME_ENV=production
DATABASE_URL="postgresql://momentum:strong-password@db.example.com:5432/momentum?sslmode=require"
CALENDAR_PROVIDER=google
ENABLE_SIMULATION_API=false
MOMENTUM_ADMIN_TOKEN="prod-admin-token-example"
OUTBOUND_AUTOMATION_TOKEN="prod-outbound-token-example"
CRON_SECRET="prod-cron-secret-example"
MOMENTUM_CRON_CLINIC_ID="clinic_pilot"
TOKEN_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
GOOGLE_CALENDAR_CLIENT_ID="google-client-id-example"
GOOGLE_CALENDAR_CLIENT_SECRET="google-client-secret-example"
GOOGLE_CALENDAR_REDIRECT_URI="https://<api-production-domain>/integrations/google-calendar/callback"
GOOGLE_CALENDAR_OAUTH_STATE_SECRET="prod-google-state-secret-example"
GOOGLE_CALENDAR_SETUP_TOKEN="prod-google-setup-token-example"
WHATSAPP_PROVIDER=kapso
KAPSO_API_KEY="kapso-api-key-example"
KAPSO_WEBHOOK_SECRET="kapso-webhook-secret-example"
KAPSO_PHONE_NUMBER_ID="123456789012345"
KAPSO_BUSINESS_ACCOUNT_ID="987654321098765"
MOMENTUM_PUBLIC_WEBHOOK_URL="https://<api-production-domain>/webhooks/whatsapp/kapso"
AI_INTERPRETER_PROVIDER=rules
```

Set this in the Vercel web project rooted at `apps/web`:

```bash
MOMENTUM_API_BASE_URL="https://<api-production-domain>"
```

Use `AI_INTERPRETER_PROVIDER=openai` only after the deterministic pilot smoke test passes.

## Deploy

The configured Vercel plan must support the selected cron frequency because this project uses sub-daily cron in `vercel.json`.

1. Provision Postgres from Vercel Marketplace.
2. Set API project production env vars.
3. Configure the API project root directory as the repository root.
4. Configure the API project build command as `npm run build:api:production`.
5. Run `npm run prisma:generate:postgres`. This only generates the Postgres Prisma Client and intentionally uses a local Postgres-shaped dummy `DATABASE_URL` from `package.json`.
6. Run `npm run prisma:migrate:deploy:postgres` with the production Postgres `DATABASE_URL` loaded, from CI or another trusted environment:

```bash
DATABASE_URL="postgresql://momentum:strong-password@db.example.com:5432/momentum?sslmode=require" \
  npm run prisma:migrate:deploy:postgres
```

7. Deploy the API project to Vercel.
8. Confirm `GET https://<api-production-domain>/health` returns `{ "status": "ok" }`.
9. Configure the web project root directory as `apps/web`.
10. Set `MOMENTUM_API_BASE_URL` in the web project to the API production domain.
11. Deploy the web project to Vercel.

## Google Calendar Setup

1. Enable Google Calendar API in Google Cloud.
2. Configure the OAuth redirect URL:
   `https://<api-production-domain>/integrations/google-calendar/callback`.
3. In Momentum private onboarding, connect Google Calendar.
4. Map every professional to a writable calendar.
5. Save the clinic profile.

## Kapso Setup

1. Use a dedicated or formally migrated WhatsApp API number.
2. Configure the webhook URL:
   `https://<api-production-domain>/webhooks/whatsapp/kapso`.
3. Configure the webhook signature secret to match `KAPSO_WEBHOOK_SECRET`.
4. Register the inbound WhatsApp message event used by Momentum.
5. Send one real inbound WhatsApp test after the clinic is active.

## Activation Checklist

Before activating a clinic:

- clinic profile exists;
- services, durations, prices, preparation, restrictions, and rules are configured;
- all bookable professionals have writable Google calendars;
- payment status is `paid`, `trial`, or `waived`;
- WhatsApp/Kapso env and webhook are configured;
- internal test mode passed;
- activation checklist flag is true;
- `ENABLE_SIMULATION_API=false`;
- `GET /health` is healthy.

## Smoke Test

1. Open the public landing at `https://<web-production-domain>`.
2. Open private onboarding at `https://<web-production-domain>/internal/onboarding`.
3. Create or load the clinic.
4. Connect Google Calendar.
5. Map professionals.
6. Pass internal test mode.
7. Activate the clinic.
8. Send a real WhatsApp message asking to book.
9. Confirm a real appointment.
10. Verify the Google Calendar event exists.
11. Reschedule through WhatsApp.
12. Verify the event moved.
13. Cancel through WhatsApp.
14. Verify the event was cancelled or deleted as designed.
15. Run the outbound cron manually:

```bash
curl -sS -X GET "https://<api-production-domain>/api/cron/outbound" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

16. Verify Vercel API logs show 2xx or 3xx status codes for `POST /webhooks/whatsapp/kapso` and `GET /api/cron/outbound`.
17. Verify Vercel API logs do not contain `whatsapp.inbound.failed`, `whatsapp.inbound.audit_failed`, or `outbound.run.rejected_inactive` during the happy-path smoke test.
18. Verify recent `AuditEvent` records include inbound, intent, booking, reschedule, and cancellation events:

```sql
SELECT "createdAt", "clinicId", "conversationId", "type", "message"
FROM "AuditEvent"
WHERE "clinicId" = '<clinicId>'
  AND "type" IN (
    'whatsapp.inbound.accepted',
    'intent.detected',
    'appointment.created',
    'appointment.rescheduled',
    'appointment.cancelled'
  )
ORDER BY "createdAt" DESC
LIMIT 50;
```

The first manual cron run can be a safe no-op. If no reminder, reactivation, or freed-slot message is due, verify only that `GET /api/cron/outbound` returns 200 and that the failure logs above are absent.

After creating a controlled due reminder, reactivation, or freed-slot case, verify recent outbound `AuditEvent` records include at least one outbound event such as `outbound.reminder.sent`, `outbound.reactivation.sent`, `outbound.freed_slot.sent`, or `whatsapp.template.sent`:

```sql
SELECT "createdAt", "clinicId", "conversationId", "type", "message"
FROM "AuditEvent"
WHERE "clinicId" = '<clinicId>'
  AND "type" IN (
    'outbound.reminder.sent',
    'outbound.reactivation.sent',
    'outbound.freed_slot.sent',
    'whatsapp.template.sent'
  )
ORDER BY "createdAt" DESC
LIMIT 50;
```

## Emergency Pause

Pause the clinic:

```bash
curl -sS -X POST "https://<api-production-domain>/internal/onboarding/clinics/<clinicId>/pause" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>"
```

Pause one conversation:

```bash
curl -sS -X POST "https://<api-production-domain>/internal/onboarding/clinics/<clinicId>/conversations/<conversationId>/pause" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator_handoff"}'
```

Resume one conversation:

```bash
curl -sS -X POST "https://<api-production-domain>/internal/onboarding/clinics/<clinicId>/conversations/<conversationId>/resume" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator_resolved"}'
```

## Common Failures

- `Production requires a Postgres DATABASE_URL`: production env is using SQLite or a missing database URL.
- `ENABLE_SIMULATION_API must be false in production`: disable simulation routes before production deploy.
- `clinic_inactive`: activation readiness is not complete.
- `google_calendar_reconnect_required`: reconnect Google Calendar with all required scopes.
- `unknown_provider_phone_number_id`: Kapso phone number id does not match `KAPSO_PHONE_NUMBER_ID`.
- Cron returns `401`: `CRON_SECRET` is missing or the Authorization header is wrong.
- Cron returns `outbound_cron_not_configured`: set `OUTBOUND_AUTOMATION_TOKEN` and `MOMENTUM_CRON_CLINIC_ID`.
