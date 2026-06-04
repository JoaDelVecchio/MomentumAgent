# WhatsApp Flows And Interactive Booking Design

## Goal

Make Momentum feel like a premium human receptionist on WhatsApp without turning the assistant into a rigid bot.

The receptionist keeps answering naturally in text. WhatsApp-native UI is used only when it improves the patient action:

- quick confirmation;
- choosing another option;
- asking for reception;
- opening a published booking Flow when configured.

## Current Problem

The current WhatsApp runtime only supports inbound text and outbound text/templates. That means buttons and Flow submissions cannot round-trip through Momentum. The patient experience is conversational only, and every action depends on the patient typing the expected phrase.

## Product Principle

Conversation remains primary. Interactions are accelerators.

Use:

- reply buttons for short, immediate decisions with at most three choices;
- list messages when Momentum has several options and the patient should pick one;
- WhatsApp Flows for structured forms or appointment booking screens, especially when availability is dynamic;
- templates with Flow buttons only outside the 24-hour user-initiated service window.

Do not use interactions for:

- open-ended questions;
- medical or ambiguous situations;
- cases that should go to a human;
- generic ChatGPT-like conversations unrelated to clinic reception.

## 2026 Implementation Guidance

Kapso's current WhatsApp Flows docs show:

- user-initiated conversations can send an interactive Flow CTA inside the 24-hour window;
- outside the service window, a template with a Flow button is required;
- a Flow CTA needs a published `flowId`, button text of 1-20 characters, and optional `flowActionPayload`;
- completed Flow responses arrive as `whatsapp.message.received` with `interactive.type: nfm_reply`, plus `kapso.flow_response`.

Kapso's interactive docs also support reply buttons and lists. Buttons are best for a small set of choices. Lists are better when there are more options or option descriptions.

For live availability, static Flow JSON is not enough. A real appointment-picker Flow needs either:

- a dynamic Flow data endpoint connected to Momentum availability; or
- Momentum sends a short-lived static set of slot options as initial Flow/list data and validates the chosen slot before booking.

## MVP Behavior

When Momentum offers or holds a pending booking in a real WhatsApp conversation:

1. Send the natural receptionist text as the message body.
2. Add WhatsApp reply buttons:
   - `Confirmar`
   - `Otro horario`
   - `Recepcion`
3. If `WHATSAPP_BOOKING_FLOW_ID` is configured, send a Flow CTA instead of plain buttons:
   - CTA: `Ver turnos` by default;
   - pass current pending booking context in `flowActionPayload.data`;
   - keep text fallback behavior for web test mode and for unconfigured providers.
4. Normalize inbound replies:
   - confirm button maps to `confirmo`;
   - change-slot button maps to `otro horario`;
   - human button maps to `hablar con recepcion`;
   - Flow `nfm_reply` maps to a deterministic booking-selection command when possible, otherwise to its submitted body.

## Safety

- Interactive sends must not change calendar state by themselves.
- Calendar writes remain inside `ConversationWorkflow` and `SchedulingService`.
- Every confirmed booking still requires the existing pending booking and patient-data checks.
- If interactive send fails, the webhook delivery remains retryable, same as text sends.
- If an inbound interactive payload is malformed, Momentum rejects it instead of guessing.

## Non-Goals For This Iteration

- Building and publishing a complete Meta Flow JSON asset.
- Implementing encrypted dynamic Flow data endpoints.
- Persisting multiple simultaneous slot locks for a full multi-slot picker.
- Replacing the chat console with WhatsApp UI simulation.

## Follow-Up Design

The next iteration should add a true slot picker:

1. Extend pending booking state with multiple short-lived slot options.
2. Send a list or dynamic Flow with 3-10 available slots.
3. On selection, validate that the chosen lock is still active.
4. Confirm through the same booking workflow.

