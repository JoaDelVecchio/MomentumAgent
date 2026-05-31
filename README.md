# Momentum

Momentum is a new project workspace initialized for the Superpowers-style agentic development workflow.

## Workflow

This repository is prepared to use the process from [obra/superpowers](https://github.com/obra/superpowers):

1. Brainstorm the project or feature before implementation.
2. Write an approved design spec in `docs/superpowers/specs/`.
3. Write a detailed implementation plan in `docs/superpowers/plans/`.
4. Implement with test-driven development.
5. Review changes before moving to the next task.
6. Verify the finished branch before delivery.

## Codex App Setup

Superpowers is installed globally through the Codex App plugin marketplace:

1. Open **Plugins** in the Codex App sidebar.
2. Find **Superpowers** in the Coding section.
3. Click `+` and follow the prompts.

The files in this repo provide project-level workflow guidance, but they do not replace the official Codex App plugin.

## Current Status

The repository contains the first local backend slice for the Momentum MVP:

- clinic profile validation;
- fake calendar source-of-truth plus Google Calendar OAuth/provider wiring;
- scheduling workflows for booking, rescheduling, and cancellation;
- WhatsApp-style conversation workflow;
- Kapso WhatsApp webhook/provider integration behind a messaging port;
- outbound policies for reminders, reactivation, and freed-slot matching;
- local simulation API;
- Prisma SQLite schema for MVP persistence.

## Local Development

Install dependencies:

```bash
npm install
```

Create local environment:

```bash
cp .env.example .env
```

Prepare Prisma locally:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Run tests:

```bash
npm test
npm run typecheck
```

Start local API:

```bash
ENABLE_SIMULATION_API=true npm run dev
```

### AI conversation interpreter

Momentum defaults to the deterministic rule-based interpreter:

```bash
AI_INTERPRETER_PROVIDER=rules
```

To enable OpenAI structured understanding for the real Kapso runtime:

```bash
AI_INTERPRETER_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
OPENAI_TIMEOUT_MS=1500
```

The model only returns structured conversation understanding. Calendar availability, booking, rescheduling, cancellation, and WhatsApp side effects remain controlled by application code.

Representative Spanish WhatsApp cases live in `tests/fixtures/conversation-evals.ts`. They are deterministic fixtures today; live OpenAI eval execution should be added only after the MVP behavior is stable enough to compare model output over time.

Simulate an inbound WhatsApp message:

```bash
curl -sS -X POST http://127.0.0.1:3000/simulate/inbound-message \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","conversationId":"conv_1","patientId":"pat_1","whatsappNumber":"+5491111111111","text":"Quiero reservar botox"}'
```

## Google Calendar Local Setup

Default local behavior uses the fake calendar:

```bash
CALENDAR_PROVIDER=fake ENABLE_SIMULATION_API=true npm run dev
```

To run with Google Calendar:

1. Create a Google Cloud OAuth client for a web application.
2. Add this redirect URI to the OAuth client:

```text
http://127.0.0.1:3000/integrations/google-calendar/callback
```

3. Set these env vars in `.env`:

```bash
CALENDAR_PROVIDER=google
ENABLE_SIMULATION_API=true
GOOGLE_CALENDAR_CLIENT_ID="..."
GOOGLE_CALENDAR_CLIENT_SECRET="..."
GOOGLE_CALENDAR_REDIRECT_URI="http://127.0.0.1:3000/integrations/google-calendar/callback"
GOOGLE_CALENDAR_SETUP_TOKEN="local-setup-token"
TOKEN_ENCRYPTION_KEY="<32-byte base64 or 64-char hex key>"
```

4. Start the API with admin onboarding enabled:

```bash
CALENDAR_PROVIDER=google MOMENTUM_ADMIN_TOKEN="local-admin-token" ENABLE_SIMULATION_API=true npm run dev:api
```

5. Start the web app:

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000" npm run dev:web
```

6. Open the private onboarding flow:

```text
http://127.0.0.1:3001/internal/onboarding
```

7. Enter `local-admin-token`, open the clinic setup page, and use the Google Calendar panel to connect Google and map each professional to a writable calendar.
8. Save the clinic profile.
9. Use test mode or `/simulate/inbound-message` to request, confirm, reschedule, or cancel a booking.
10. Verify the event appears, moves, or disappears in the mapped Google Calendar.

Required calendar scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.events.freebusy`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

## Kapso WhatsApp Local Setup

Set these env vars to mount the real WhatsApp webhook:

```bash
WHATSAPP_PROVIDER=kapso
KAPSO_API_KEY="..."
KAPSO_WEBHOOK_SECRET="..."
KAPSO_PHONE_NUMBER_ID="..."
KAPSO_BUSINESS_ACCOUNT_ID="..."
MOMENTUM_PUBLIC_WEBHOOK_URL="https://your-tunnel.example.com"
```

When `WHATSAPP_PROVIDER=kapso`, Momentum stores operational patient-agent state in Prisma:

- patients;
- conversations and pending bookings;
- appointments;
- opt-out;
- processed webhook delivery keys;
- audit events.

Run Prisma migrations before real webhook testing:

```bash
npm run prisma:migrate -- --name init
```

Local smoke test:

1. Start the API:

```bash
npm run dev
```

2. Expose the local API with a tunnel and set `MOMENTUM_PUBLIC_WEBHOOK_URL` to that public URL.
3. In Kapso, register a webhook for `whatsapp.message.received` pointing to:

```text
https://your-tunnel.example.com/webhooks/whatsapp/kapso
```

4. Send a WhatsApp text to the connected number.
5. Verify Momentum replies through Kapso.
6. Re-send the same webhook delivery with the same `X-Idempotency-Key` and verify it does not create a duplicate reply.

## Outbound Automation Local Run

Outbound automation sends approved WhatsApp templates for:

- appointment reminders;
- warm abandoned-booking reactivation;
- freed-slot offers after cancellation or reschedule.

Set an internal token to enable the cron/manual route:

```bash
OUTBOUND_AUTOMATION_TOKEN="local-outbound-token"
```

Run due reminders and reactivations:

```bash
curl -sS -X POST http://127.0.0.1:3000/internal/outbound/run \
  -H 'authorization: Bearer local-outbound-token' \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1"}'
```

For deterministic local testing, pass `now`:

```bash
curl -sS -X POST http://127.0.0.1:3000/internal/outbound/run \
  -H 'authorization: Bearer local-outbound-token' \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","now":"2026-06-02T12:00:00.000Z"}'
```

Every outbound send is guarded by opt-out state, handoff pause, quiet hours, durable delivery keys, and audit logging.

## Public Landing And Clinic Onboarding Local Setup

Momentum includes a public landing page and a private onboarding flow for assisted clinic activation.

Start the API:

```bash
MOMENTUM_ADMIN_TOKEN="local-admin-token" ENABLE_SIMULATION_API=true npm run dev:api
```

Start the web app:

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000" npm run dev:web
```

Open:

- `http://127.0.0.1:3001` for the public landing.
- `http://127.0.0.1:3001/lead` for lead capture.
- `http://127.0.0.1:3001/internal/onboarding` for private onboarding.

Use `local-admin-token` in the private onboarding screen.

Clinic production WhatsApp and outbound automation remain disabled until the clinic is marked active.
