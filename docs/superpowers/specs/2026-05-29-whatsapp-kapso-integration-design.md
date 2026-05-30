# WhatsApp Kapso Integration Mini PRD

Date: 2026-05-29
Status: Draft for user review

## Summary

The next Momentum block connects the existing appointment conversation workflow to real WhatsApp through Kapso.

Kapso is the first WhatsApp provider because it gives Momentum faster onboarding, webhook delivery, message sending, template support, and WhatsApp Business App coexistence while still staying close to the official WhatsApp Cloud API model.

Momentum must keep its own product logic. Kapso is the transport and WhatsApp operations layer, not the brain of the agent.

## Goal

Let a real WhatsApp message reach Momentum, run through the existing `ConversationWorkflow`, use the already implemented calendar provider when the flow reaches scheduling, and send the resulting reply back to the same WhatsApp chat through Kapso.

This block should prove the real WhatsApp edge without changing the calendar domain. Google Calendar remains the current real agenda provider; Outlook stays for a later integration block.

## Non-Goals

This block does not include:
- New calendar provider work beyond using the existing Google Calendar integration.
- Outlook integration.
- OpenAI-powered intent interpretation.
- Full production persistence.
- Customer dashboard.
- WhatsApp Flows/buttons as the primary booking UI.
- Bulk campaign tooling.
- Payments or deposits.
- Alternative WhatsApp providers beyond the internal adapter boundary.

## Product Decisions

- Use Kapso first, behind a provider-neutral messaging port.
- Keep the existing simulation API for local tests and development.
- Use Kapso-format webhooks first instead of raw Meta forwarding.
- Support text inbound messages first.
- Treat media, voice, documents, unsupported message types, clinical/sensitive cases, and low-confidence cases as handoff candidates.
- Handoff stays in the same WhatsApp chat: Momentum sends a final handoff message, pauses the conversation, and does not keep replying automatically.
- Templates are Momentum-managed. The clinic should not configure templates during onboarding.
- No unofficial WhatsApp Web / QR automation.

## Required Capabilities

Inbound:
- Receive Kapso `whatsapp.message.received` webhook events.
- Verify webhook authenticity using the configured secret/signature mechanism.
- Normalize webhook payloads into Momentum's internal inbound message shape.
- Route messages to the correct clinic by Kapso `phone_number_id`.
- Derive stable `conversationId`, `patientId`, and WhatsApp recipient identity from the webhook.
- Ignore duplicate inbound events using Kapso's `X-Idempotency-Key`, falling back to provider message id only when needed.
- Audit every accepted inbound event.

Reply:
- Send Momentum's reply text through Kapso.
- Store or audit the provider message id returned by Kapso.
- Do not send automated replies when the conversation is bot-paused.
- Preserve `/simulate/inbound-message` behavior for local development.

Outbound primitives:
- Add a provider method for approved template messages so reminders, reactivation, and freed-slot offers can use it later.
- Enforce opt-out before outbound template sends.
- Keep actual cron/scheduler execution for a later production block.

Error handling:
- If webhook verification fails, return HTTP 401 and do not process.
- If payload parsing fails, return HTTP 400 and audit nothing.
- If Kapso send fails, return a retryable server error and audit the failure.
- If an inbound message has no text content, respond with a short handoff/unsupported-message path or pause depending on workflow result.

## Data Flow

1. Patient sends WhatsApp message to the clinic number.
2. Kapso sends `whatsapp.message.received` to Momentum's webhook endpoint.
3. Momentum verifies the webhook and normalizes the event.
4. Momentum maps `phone_number_id` to `clinicId`.
5. Momentum calls the existing `ConversationWorkflow`.
6. If workflow returns `reply`, Momentum sends text through Kapso.
7. If workflow returns `handoff`, Momentum sends the handoff text once and leaves the conversation paused.
8. Momentum records inbound, intent, outbound, handoff, and send-failure audit events.

## Configuration

Required environment/config:
- `WHATSAPP_PROVIDER=kapso`
- `KAPSO_API_KEY`
- `KAPSO_WEBHOOK_SECRET`
- `KAPSO_PHONE_NUMBER_ID`
- `KAPSO_BUSINESS_ACCOUNT_ID` for template management later
- `MOMENTUM_PUBLIC_WEBHOOK_URL` for webhook registration outside app code

The MVP assumes one clinic phone number. Multi-clinic/multi-number routing must be represented internally as a mapping from provider phone number id to clinic id, even if the local implementation starts with one mapping.

## Acceptance Criteria

- A Kapso inbound text webhook can trigger the existing booking flow.
- The first booking reply is sent through Kapso's message API.
- Duplicate webhooks using the same `X-Idempotency-Key` do not produce duplicate replies.
- Handoff pauses the bot in the same conversation.
- Opted-out numbers cannot receive outbound template sends.
- Tests cover webhook parsing, verification failure, duplicate protection, Kapso send success/failure, and simulation API compatibility.
- No application logic depends directly on Kapso outside the WhatsApp adapter.

## Sources

- Kapso receive messages: https://docs.kapso.ai/docs/whatsapp/receive-messages
- Kapso webhook event types: https://docs.kapso.ai/docs/platform/webhooks/event-types
- Kapso webhook security and idempotency: https://docs.kapso.ai/docs/platform/webhooks/security
- Kapso create webhook: https://docs.kapso.ai/api/platform/v1/webhooks/create-webhook
- Kapso send message API: https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message
- Kapso templates API: https://docs.kapso.ai/api/meta/whatsapp/templates/list-message-templates
- WhatsApp Business policy: https://business.whatsapp.com/policy/
- WhatsApp Business Platform pricing: https://whatsappbusiness.com/products/platform-pricing/
