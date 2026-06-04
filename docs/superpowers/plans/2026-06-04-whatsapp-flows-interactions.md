# WhatsApp Flows And Interactive Booking Implementation Plan

**Goal:** Add provider-neutral WhatsApp interactive support and use it selectively in booking conversations.

**Files:**

- `src/ports/messaging.ts`
- `src/adapters/memory/fake-whatsapp-provider.ts`
- `src/adapters/whatsapp/kapso/kapso-whatsapp-provider.ts`
- `src/adapters/whatsapp/kapso/types.ts`
- `src/application/messaging/whatsapp-inbound-service.ts`
- `src/config/whatsapp.ts`
- `src/runtime/server-runtime.ts`
- `.env.example`
- `README.md`
- `tests/whatsapp-provider.test.ts`
- `tests/kapso-webhook.test.ts`

## Task 1: Interactive Messaging Port

1. Add `SendInteractiveMessageInput` with button, list, and Flow variants.
2. Add `sendInteractive()` to `WhatsAppProvider`.
3. Update fake provider to record interactive sends.
4. Add tests in `tests/whatsapp-provider.test.ts`.

Command:

```bash
npm test -- tests/whatsapp-provider.test.ts
```

Expected result: interactive tests pass with existing text/template behavior unchanged.

## Task 2: Kapso Interactive Adapter

1. Send button payloads as WhatsApp `type: "interactive"`, `interactive.type: "button"`.
2. Send list payloads as `interactive.type: "list"`.
3. Send Flow payloads as `interactive.type: "flow"` with `flow_message_version`, `flow_token`, `flow_id`, `flow_cta`, `flow_action`, and optional `flow_action_payload`.
4. Reuse the same Kapso endpoint and error handling.

Command:

```bash
npm test -- tests/whatsapp-provider.test.ts
```

Expected result: Kapso payload tests pass.

## Task 3: Inbound Interactive Normalization

1. Accept Kapso inbound text, button replies, list replies, and Flow `nfm_reply`.
2. Map Momentum action ids to receptionist commands.
3. Parse `kapso.flow_response` or `interactive.nfm_reply.response_json` for submitted Flow data.
4. Reject unsupported payloads with `KapsoWebhookPayloadError`.

Command:

```bash
npm test -- tests/kapso-webhook.test.ts
```

Expected result: inbound interactive payloads become deterministic text messages for the existing workflow.

## Task 4: Selective Booking Interactions

1. After workflow response, reload conversation state.
2. If there is a pending booking and the response is a normal reply, send interactive booking actions instead of plain text.
3. Use Flow CTA only when `WHATSAPP_BOOKING_FLOW_ID` is configured.
4. Persist and retry webhook delivery exactly like text sends.
5. Keep handoff responses as plain text.

Command:

```bash
npm test -- tests/kapso-webhook.test.ts tests/prisma-runtime-persistence.test.ts
```

Expected result: webhook idempotency and retry semantics remain stable.

## Task 5: Configuration, Docs, And Verification

1. Add optional env vars for booking Flow id and CTA.
2. Wire runtime config into `WhatsAppInboundService`.
3. Update README and `.env.example`.
4. Run focused tests, full tests, and type checks.

Commands:

```bash
npm test -- tests/whatsapp-provider.test.ts tests/kapso-webhook.test.ts tests/prisma-runtime-persistence.test.ts tests/server-runtime.test.ts tests/runtime-environment.test.ts
npm test
npm run typecheck
npm run typecheck:web
```

Expected result: all pass before commit and push.

