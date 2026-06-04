# Momentum Agent

Momentum is an AI receptionist for aesthetic clinics and cosmetic dermatology practices. It turns WhatsApp conversations into confirmed appointments while keeping the clinic's existing calendar as the source of truth.

The product is not meant to be a generic chatbot. The core workflow is: understand the patient, answer approved commercial and operational questions, offer real availability, book or move the appointment, and hand off to a human when the conversation should not be automated.

## What It Does

- Receives patient and lead messages from WhatsApp.
- Uses WhatsApp-native buttons, lists, and optional booking Flow CTAs when they reduce friction.
- Understands booking, rescheduling, cancellation, confirmation, FAQ, opt-out, and handoff intent.
- Answers approved questions about services, prices, duration, preparation, restrictions, payment, and insurance.
- Reads real availability from calendar providers.
- Books, reschedules, and cancels appointments in the connected calendar.
- Preserves pending booking state across service restarts.
- Sends outbound automations for reminders, abandoned-booking reactivation, and freed-slot offers.
- Applies quiet hours, opt-out, idempotency, audit logging, and handoff controls.
- Provides a web onboarding flow for clinic setup, calendar connection, activation, and test conversations.

## Current Scope

Momentum currently targets the first MVP/pilot slice:

- external patient-facing WhatsApp agent;
- Google Calendar as the primary real calendar integration;
- Kapso as the WhatsApp transport integration;
- Prisma persistence with SQLite for local development and Postgres for production;
- a private onboarding and test-mode web app under `apps/web`.

Intentionally out of scope for this stage:

- medical diagnosis or treatment recommendations;
- payments or deposits;
- clinical records;
- a full CRM replacement;
- a mobile app;
- internal staff assistant workflows.

## Architecture

```text
apps/web/          Next.js web app for landing, lead capture, onboarding, activation, and test mode
api/               Vercel function entrypoints
src/api/           Fastify routes and HTTP adapters
src/application/   Use cases for conversations, scheduling, onboarding, messaging, and outbound automation
src/adapters/      Google Calendar, Kapso WhatsApp, Prisma, memory, and OpenAI adapters
src/domain/        Product/domain models and validation
src/ports/         Interfaces for persistence, calendars, messaging, audit, and activation
src/runtime/       Production runtime wiring and Vercel handlers
prisma/            SQLite schema and migrations
prisma/postgres/   Postgres schema and migrations for production
tests/             Unit, integration, persistence, webhook, runtime, and web behavior tests
docs/              Product specs, implementation plans, and operational runbooks
```

## Tech Stack

- TypeScript
- Fastify
- Next.js
- Prisma
- Vitest
- Google Calendar API
- Kapso WhatsApp API
- OpenAI structured conversation understanding, optional and guarded behind application rules
- Vercel Functions, Cron, and managed Postgres for production deployment

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Edit `.env` locally. Do not commit `.env`, Vercel local env files, database files, OAuth secrets, API keys, or webhook secrets.

Prepare Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Run the API:

```bash
npm run dev:api
```

Run the web app:

```bash
npm run dev:web
```

Common local URLs:

- API: `http://127.0.0.1:3000`
- Web: `http://127.0.0.1:3001`
- Private onboarding: `http://127.0.0.1:3001/internal/onboarding`

## Configuration

The repository includes `.env.example` with safe placeholders. These are the main groups of settings:

| Area | Variables |
| --- | --- |
| Runtime | `MOMENTUM_RUNTIME_ENV`, `PORT`, `HOST` |
| Database | `DATABASE_URL` |
| Admin and cron | `MOMENTUM_ADMIN_TOKEN`, `CRON_SECRET`, `MOMENTUM_CRON_CLINIC_ID`, `OUTBOUND_AUTOMATION_TOKEN` |
| Simulation | `ENABLE_SIMULATION_API`, `SIMULATION_CLINIC_ID`, `SIMULATION_CLINIC_TIMEZONE` |
| AI | `AI_INTERPRETER_PROVIDER`, `AI_INTERPRETER_FALLBACK`, `AI_RESPONSE_COMPOSER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_TIMEOUT_MS` |
| Calendar | `CALENDAR_PROVIDER`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_OAUTH_STATE_SECRET`, `GOOGLE_CALENDAR_SETUP_TOKEN` |
| WhatsApp | `WHATSAPP_PROVIDER`, `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_BUSINESS_ACCOUNT_ID`, `MOMENTUM_PUBLIC_WEBHOOK_URL`, `WHATSAPP_BOOKING_FLOW_ID`, `WHATSAPP_BOOKING_FLOW_CTA`, `WHATSAPP_BOOKING_FLOW_SCREEN` |
| Web | `NEXT_PUBLIC_API_BASE_URL`, `MOMENTUM_API_BASE_URL` |

Local development can run with the fake calendar and simulation API. Real Google Calendar, WhatsApp, OpenAI, cron, and production database credentials should only be configured through local `.env` files or the deployment provider's secret manager.

## Testing

Run the full suite:

```bash
npm test
```

Run type checks:

```bash
npm run typecheck
npm run typecheck:web
```

The suite covers:

- service and professional matching;
- appointment booking, rescheduling, cancellation, and conflict checks;
- conversation intent workflows;
- pending booking persistence;
- Google Calendar OAuth and calendar mapping;
- Kapso webhook verification and idempotency;
- outbound reminders, reactivation, freed-slot offers, opt-out, quiet hours, and delivery retries;
- onboarding, activation, and test mode;
- Vercel runtime wiring.

## Running With Real Integrations

### Google Calendar

1. Create a Google Cloud OAuth web client.
2. Configure the local callback URL in the OAuth client.
3. Set the Google Calendar variables in `.env`.
4. Start API and web locally.
5. Open the private onboarding flow.
6. Connect Google Calendar and map each professional to a writable calendar.
7. Save the clinic profile and use test mode to validate booking, rescheduling, and cancellation.

Required Google scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.events.freebusy`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

### WhatsApp

Set the WhatsApp provider to Kapso and configure Kapso credentials in a local secret file or hosted secret store. Register the webhook URL for incoming WhatsApp messages. Momentum verifies inbound signatures, stores delivery keys, and avoids duplicate side effects.

When a WhatsApp conversation has a pending booking, Momentum sends reply buttons for `Confirmar`, `Otro horario`, and `Recepcion` instead of forcing the patient to type exact phrases. If `WHATSAPP_BOOKING_FLOW_ID` is configured with a published WhatsApp Flow id, Momentum sends a Flow CTA for the pending booking context. Leave it blank until the clinic has a published Flow; the button fallback remains active.

Live availability inside a Flow requires a dynamic WhatsApp Flow data endpoint or a future multi-slot picker. Calendar writes still happen only through Momentum's scheduling workflow after validation.

### OpenAI

Momentum can use deterministic rules or OpenAI structured understanding. OpenAI output is limited to conversation understanding. Calendar writes, WhatsApp sends, booking confirmations, cancellations, handoff, and outbound automation are controlled by application code.

## Production Deployment

Production is designed around two Vercel projects:

- API project at the repository root.
- Web project rooted at `apps/web`.

Useful build commands:

```bash
npm run build:api:production
npm run build:web:production
npm run build:production
```

Production should use:

- Postgres `DATABASE_URL`;
- simulation API disabled;
- real calendar and WhatsApp providers only after clinic activation;
- admin, cron, webhook, OAuth, encryption, and OpenAI secrets configured as protected environment variables;
- outbound automation guarded by cron/internal bearer tokens.

The live pilot runbook is in `docs/runbooks/live-pilot.md`.

## Safety And Security

- Never commit `.env`, `.env.*`, `.vercel`, local databases, generated builds, private keys, API keys, webhook secrets, OAuth secrets, or production tokens.
- Admin onboarding, activation, conversation control, and outbound routes require bearer-token authorization.
- Calendar events are written only through the scheduling service, after availability and conflict checks.
- The calendar remains the source of truth for availability.
- Medical-safety language routes to human handoff instead of diagnosis.
- Outbound messages are guarded by opt-out state, quiet hours, durable delivery keys, and audit logging.
- Webhook processing is idempotent and signature-verified where the provider supports it.
- Production should not run with local simulation endpoints enabled.

## Development Workflow

This repo follows the Superpowers-style workflow documented in `AGENTS.md` and `docs/superpowers/`:

1. Define the product behavior.
2. Save approved design specs under `docs/superpowers/specs/`.
3. Write implementation plans under `docs/superpowers/plans/`.
4. Implement with small, testable tasks.
5. Use test-driven development for behavior changes.
6. Run focused tests, full tests, and type checks before publishing changes.

## License

Private project. No license is granted unless one is added explicitly.
