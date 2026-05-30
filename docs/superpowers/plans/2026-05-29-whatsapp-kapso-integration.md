# WhatsApp Kapso Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Momentum's existing conversation workflow to real WhatsApp through Kapso while keeping provider lock-in behind a narrow adapter.

**Architecture:** Add a provider-neutral messaging port, a Kapso HTTP adapter, and a webhook ingestion service. The existing `ConversationWorkflow` remains the appointment brain; WhatsApp transport only normalizes inbound messages and sends outbound replies/templates.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Zod, Vitest, native `fetch`, Kapso WhatsApp/Platform APIs.

---

## Scope Check

This plan intentionally implements the WhatsApp edge only:
- inbound Kapso webhook ingestion;
- outbound text replies;
- outbound approved-template primitive;
- provider idempotency;
- audit events;
- tests with fake provider and mocked network.

It does not implement a new calendar provider, Outlook, OpenAI intent interpretation, deployment, cron jobs, or production database repositories. The existing Google Calendar provider remains available to the conversation workflow and should not be changed by this block unless a WhatsApp route wiring issue requires it.

## File Structure

- `src/ports/messaging.ts`: provider-neutral WhatsApp messaging interface and normalized message types.
- `src/adapters/memory/fake-whatsapp-provider.ts`: fake provider for tests and local orchestration.
- `src/adapters/whatsapp/kapso/types.ts`: Zod schemas for Kapso webhook and API response payloads used by Momentum.
- `src/adapters/whatsapp/kapso/signature.ts`: webhook signature verification helper.
- `src/adapters/whatsapp/kapso/kapso-whatsapp-provider.ts`: Kapso implementation of `WhatsAppProvider`.
- `src/application/messaging/whatsapp-inbound-service.ts`: orchestrates inbound webhook message -> conversation workflow -> provider send.
- `src/api/whatsapp-routes.ts`: Fastify webhook routes for Kapso.
- `src/api/app.ts`: registers WhatsApp routes when provider config is present.
- `src/config/whatsapp.ts`: reads and validates WhatsApp/Kapso env configuration.
- `src/adapters/memory/repositories.ts`: stores processed webhook idempotency keys for duplicate protection.
- `tests/whatsapp-provider.test.ts`: fake provider and Kapso adapter tests.
- `tests/kapso-webhook.test.ts`: webhook parsing, signature failure, duplicate handling, and reply integration tests.
- `tests/simulation-api.test.ts`: verifies the simulation API still works.
- `.env.example`: documents new env vars.
- `README.md`: adds local Kapso webhook setup notes.

## Task 1: Add Provider-Neutral Messaging Port

**Files:**
- Create: `src/ports/messaging.ts`
- Create: `src/adapters/memory/fake-whatsapp-provider.ts`
- Test: `tests/whatsapp-provider.test.ts`

- [ ] **Step 1: Write failing port/fake-provider tests**

Create `tests/whatsapp-provider.test.ts` with tests that assert:
- `FakeWhatsAppProvider.sendText()` records recipient, text, and provider message id.
- `FakeWhatsAppProvider.sendTemplate()` records template name, language, parameters, and provider message id.
- `FakeWhatsAppProvider.failNextSend()` makes the next send reject with a provider error.

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts
```

Expected: FAIL because the messaging port and fake provider do not exist.

- [ ] **Step 2: Add messaging port and fake provider**

Create `src/ports/messaging.ts` with:
- `NormalizedWhatsAppInboundMessage`
- `SendTextMessageInput`
- `SendTemplateMessageInput`
- `SendMessageResult`
- `WhatsAppProviderError`
- `WhatsAppProvider` interface with `sendText()` and `sendTemplate()`.

Create `src/adapters/memory/fake-whatsapp-provider.ts` implementing the interface with deterministic ids: `msg_1`, `msg_2`, etc.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts
npm run typecheck
```

Expected: provider tests pass and TypeScript passes.

Commit:

```bash
git add src/ports/messaging.ts src/adapters/memory/fake-whatsapp-provider.ts tests/whatsapp-provider.test.ts
git commit -m "feat: add whatsapp messaging port"
```

## Task 2: Add Kapso Adapter With Mocked Network Tests

**Files:**
- Create: `src/adapters/whatsapp/kapso/types.ts`
- Create: `src/adapters/whatsapp/kapso/kapso-whatsapp-provider.ts`
- Test: `tests/whatsapp-provider.test.ts`

- [ ] **Step 1: Add failing Kapso send tests**

Extend `tests/whatsapp-provider.test.ts` with tests that mock `fetch` and assert:
- `sendText()` POSTs to `https://api.kapso.ai/meta/whatsapp/v24.0/{phoneNumberId}/messages`.
- `sendText()` sends `X-API-Key`.
- `sendText()` sends WhatsApp text payload with `messaging_product`, `recipient_type`, `to`, `type`, and `text.body`.
- `sendTemplate()` sends WhatsApp template payload with `type: "template"`.
- non-2xx Kapso responses throw `WhatsAppProviderError`.

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts
```

Expected: FAIL because the Kapso adapter does not exist.

- [ ] **Step 2: Implement Kapso adapter**

Implement `KapsoWhatsAppProvider` with constructor config:
- `apiKey`
- `phoneNumberId`
- `baseUrl`, defaulting to `https://api.kapso.ai/meta/whatsapp`
- optional injectable `fetch`

Use the Kapso v24 message endpoint for both text and template messages.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/adapters/whatsapp/kapso/types.ts src/adapters/whatsapp/kapso/kapso-whatsapp-provider.ts tests/whatsapp-provider.test.ts
git commit -m "feat: add kapso whatsapp provider"
```

## Task 3: Add Kapso Webhook Normalization and Verification

**Files:**
- Create: `src/adapters/whatsapp/kapso/signature.ts`
- Modify: `src/adapters/whatsapp/kapso/types.ts`
- Test: `tests/kapso-webhook.test.ts`

- [ ] **Step 1: Write failing webhook tests**

Create `tests/kapso-webhook.test.ts` with tests that assert:
- a valid `whatsapp.message.received` payload normalizes into `NormalizedWhatsAppInboundMessage`;
- `phone_number_id` is preserved for clinic routing;
- `message.kapso.content` becomes internal `text`;
- `conversation.id` becomes internal `conversationId`;
- `conversation.phone_number`, `message.from`, or available identity fields produce a stable `patientId` and recipient identity;
- `X-Idempotency-Key` becomes internal `idempotencyKey`;
- malformed payloads fail validation;
- invalid signatures fail verification.

Run:

```bash
npm test -- tests/kapso-webhook.test.ts
```

Expected: FAIL because normalization and signature helpers do not exist.

- [ ] **Step 2: Implement schemas and signature helper**

Implement the narrow webhook parser for the Kapso v2 payload fields Momentum needs:
- top-level event type;
- `phone_number_id`;
- `message.id`;
- `message.type`;
- `message.kapso.content`;
- `conversation.id`;
- `conversation.phone_number`;
- optional BSUID identity fields.

Implement webhook verification using HMAC SHA-256 over the raw JSON request body and `KAPSO_WEBHOOK_SECRET`, accepting only the `X-Webhook-Signature` header.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/kapso-webhook.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/adapters/whatsapp/kapso/signature.ts src/adapters/whatsapp/kapso/types.ts tests/kapso-webhook.test.ts
git commit -m "feat: parse kapso whatsapp webhooks"
```

## Task 4: Add WhatsApp Inbound Application Service

**Files:**
- Create: `src/application/messaging/whatsapp-inbound-service.ts`
- Modify: `src/adapters/memory/repositories.ts`
- Test: `tests/kapso-webhook.test.ts`

- [ ] **Step 1: Write failing inbound orchestration tests**

Extend `tests/kapso-webhook.test.ts` with tests that assert:
- inbound text calls `ConversationWorkflow.handleInboundMessage()`;
- workflow `reply` is sent through `WhatsAppProvider.sendText()`;
- workflow `handoff` sends the handoff text once;
- bot-paused conversations do not keep sending automated replies;
- duplicated idempotency keys are ignored and return a no-op result.

Run:

```bash
npm test -- tests/kapso-webhook.test.ts
```

Expected: FAIL because the inbound service and idempotency repository methods do not exist.

- [ ] **Step 2: Implement inbound service and idempotency**

Add repository methods:
- `hasProcessedWebhookDelivery(idempotencyKey: string): boolean`
- `markProcessedWebhookDelivery(idempotencyKey: string): void`

Implement `WhatsAppInboundService` that:
- receives a normalized inbound message;
- skips duplicates;
- calls `ConversationWorkflow`;
- sends reply/handoff text through the provider;
- marks the idempotency key as processed only after the outbound send succeeds, so retryable send failures can be retried;
- records audit events for inbound accepted, outbound sent, duplicate ignored, and send failure.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/kapso-webhook.test.ts tests/conversation-workflow.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/application/messaging/whatsapp-inbound-service.ts src/adapters/memory/repositories.ts tests/kapso-webhook.test.ts
git commit -m "feat: route whatsapp inbound messages"
```

## Task 5: Add Fastify Kapso Webhook Route

**Files:**
- Create: `src/api/whatsapp-routes.ts`
- Modify: `src/api/app.ts`
- Create: `src/config/whatsapp.ts`
- Test: `tests/kapso-webhook.test.ts`

- [ ] **Step 1: Write failing route tests**

Extend `tests/kapso-webhook.test.ts` with Fastify injection tests that assert:
- `POST /webhooks/whatsapp/kapso` returns 401 on invalid signature;
- returns 400 on invalid payload;
- returns 200 on valid message and sends exactly one provider message;
- duplicate valid delivery returns 200 and sends no second reply.

Run:

```bash
npm test -- tests/kapso-webhook.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 2: Implement route and app wiring**

Implement `registerWhatsAppRoutes()` with raw body access for signature verification.

Modify `buildApp()` to accept optional WhatsApp route dependencies so tests can inject fake provider, repositories, scheduling service, workflow, and audit logger without real Kapso credentials.

Add `src/config/whatsapp.ts` for env parsing and runtime provider selection.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/kapso-webhook.test.ts tests/health.test.ts tests/simulation-api.test.ts
npm run typecheck
```

Expected: webhook, health, simulation, and typecheck pass.

Commit:

```bash
git add src/api/whatsapp-routes.ts src/api/app.ts src/config/whatsapp.ts tests/kapso-webhook.test.ts
git commit -m "feat: add kapso webhook route"
```

## Task 6: Add Outbound Template Primitive and Compliance Guard

**Files:**
- Create: `src/application/messaging/outbound-template-service.ts`
- Modify: `src/adapters/memory/repositories.ts`
- Test: `tests/whatsapp-provider.test.ts`

- [ ] **Step 1: Write failing outbound template tests**

Extend `tests/whatsapp-provider.test.ts` with tests that assert:
- template send is blocked when the WhatsApp number is opted out;
- template send records an audit event on success;
- template send records an audit event and rethrows on provider failure;
- allowed sends call `WhatsAppProvider.sendTemplate()`.

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts
```

Expected: FAIL because outbound template service does not exist.

- [ ] **Step 2: Implement outbound template service**

Implement `OutboundTemplateService` with:
- `sendApprovedTemplate(input)`;
- opt-out check through repositories;
- provider send through `WhatsAppProvider`;
- audit on sent, blocked, and failed.

This service is a primitive for later reminders, reactivation, and freed-slot jobs. It does not schedule jobs in this block.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/whatsapp-provider.test.ts tests/outbound-policies.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/application/messaging/outbound-template-service.ts src/adapters/memory/repositories.ts tests/whatsapp-provider.test.ts
git commit -m "feat: add outbound whatsapp template service"
```

## Task 7: Document Local Kapso Setup and Final Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document env vars**

Add:
- `WHATSAPP_PROVIDER=kapso`
- `KAPSO_API_KEY`
- `KAPSO_WEBHOOK_SECRET`
- `KAPSO_PHONE_NUMBER_ID`
- `KAPSO_BUSINESS_ACCOUNT_ID`
- `MOMENTUM_PUBLIC_WEBHOOK_URL`

- [ ] **Step 2: Document manual smoke test**

Add README steps:
- start local server;
- expose local webhook with a tunnel;
- register Kapso webhook for `whatsapp.message.received`;
- send a WhatsApp text to the connected number;
- verify Momentum sends a reply;
- verify duplicate webhook does not duplicate the reply.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test -- --run
npm run typecheck
git status --short
```

Expected:
- all tests pass;
- typecheck passes;
- git status only shows intended README/env docs before commit.

- [ ] **Step 4: Commit docs**

```bash
git add .env.example README.md
git commit -m "docs: add kapso whatsapp setup"
```

## Plan Self-Review

- Spec coverage: inbound webhook, reply delivery, template primitive, handoff pause, opt-out, duplicate protection, and simulation compatibility are each covered by at least one task.
- Placeholder scan: no task relies on unspecified future behavior.
- Type consistency: provider types are introduced before adapters and services consume them.
- Scope check: Outlook, production persistence, deployment, and OpenAI interpretation remain separate blocks; Google Calendar is already present and should continue working through the existing workflow.
