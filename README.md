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

4. Start the API and open:

```text
http://127.0.0.1:3000/integrations/google-calendar/start?clinicId=clinic_1&setupToken=local-setup-token
```

5. Complete Google consent. Momentum stores encrypted OAuth credentials in Prisma.
6. Set the seeded professional `calendarId` in `src/dev/seed.ts` to the real Google calendar id you want to test.
7. Use `/simulate/inbound-message` to request, confirm, reschedule, or cancel a booking.
8. Verify the event appears, moves, or disappears in Google Calendar.

Required calendar scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.events.freebusy`

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
