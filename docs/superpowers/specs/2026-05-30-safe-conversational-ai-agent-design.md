# Safe Conversational AI Agent Design

Date: 2026-05-30
Status: Draft for user review

## Summary

Momentum currently handles WhatsApp conversations with a deterministic keyword interpreter. That is enough for controlled tests, but it is too brittle for real patient messages with mixed questions, spelling variation, professional preferences, time preferences, and safety-sensitive medical language.

This block adds an OpenAI-backed conversational understanding layer while keeping all appointment actions under deterministic application workflows.

The model improves interpretation and receptionist-like wording. It does not directly create, reschedule, or cancel appointments.

## Goal

Let Momentum understand realistic WhatsApp messages and answer approved clinic FAQs without turning the model into the source of truth for calendar actions, prices, or medical advice.

The user-visible result should feel more like a premium receptionist:
- understands natural patient language;
- answers service, price, duration, preparation, and restriction questions from the clinic profile;
- extracts booking preferences;
- escalates clinical/sensitive cases;
- still only books when the deterministic workflow has a concrete slot, confirmation, and required patient data.

## Non-Goals

This block does not include:
- full autonomous agent tool-calling for calendar actions;
- direct model access to Google Calendar, Kapso, Prisma, or scheduling repositories;
- diagnosis, treatment recommendation, eligibility decisions, or clinical triage;
- voice notes, image understanding, or document handling;
- dashboard/onboarding UI;
- analytics UI;
- reminder/reactivation/freed-slot schedulers;
- Outlook integration;
- fine-tuning.

## Product Decisions

- Use a hybrid architecture: model for understanding and safe wording; code for side effects.
- Keep the existing rule-based interpreter as the local fallback.
- Add an interpreter port so the workflow can use either rules or OpenAI without coupling domain logic to a vendor.
- Use structured model output instead of free-form parsing.
- The model may suggest a next action, but the workflow validates and executes only allowed transitions.
- Use deterministic response composition for factual clinic data by default. If the model drafts wording, the workflow may only use it when it is grounded in fields supplied to the model and the action remains non-sensitive.
- FAQs must be grounded in `ClinicProfile`; if data is missing, Momentum should say it does not have that information and offer handoff.
- Medical/sensitive requests should route to handoff instead of being answered.
- Calendar availability, booking, rescheduling, and cancellation remain controlled by `SchedulingService` and `CalendarPort`.
- Time and professional preferences extracted by the interpreter should affect the slot search when they map cleanly to configured professionals or a concrete date/daypart. If the preference is vague, the workflow should acknowledge it and still offer the best available options without inventing availability.

## Required Capabilities

Conversation understanding:
- Classify intent as one of: `book`, `confirm`, `reschedule`, `cancel`, `question`, `handoff`, `medical_safety`, or `unknown`.
- Extract optional entities:
  - service name;
  - professional preference;
  - time preference in natural text plus a normalized date/daypart when possible;
  - requested topic such as price, duration, preparation, restrictions, payment, or insurance;
  - patient full name if clearly provided.
- Return confidence and a short reason for audit/debugging.
- Never return executable calendar actions.

FAQ handling:
- Answer from configured service data:
  - service name;
  - price/range;
  - duration;
  - preparation;
  - restrictions.
- Support mixed messages such as "cuanto sale botox y tenes para la tarde?"
- Prefer deterministic factual fragments for price, duration, preparation, and restrictions, then optionally let the model smooth the tone around those facts.
- If the patient asks about insurance/payment and the clinic profile lacks that knowledge, answer with a safe fallback and offer human help.
- If the patient asks for personalized medical advice, eligibility, diagnosis, risks for their personal case, or recommendations, trigger handoff.

Workflow integration:
- `ConversationWorkflow` should depend on an async interpreter port.
- The current rule-based interpreter remains available for tests and local fallback.
- When OpenAI is enabled, the workflow uses model output to choose the same existing deterministic paths:
  - booking intent calls `handleBookingIntent` with the resolved service and any usable professional/time preferences;
  - confirmation calls `handleConfirmation`;
  - cancellation calls `handleCancelIntent`;
  - reschedule calls `handleRescheduleIntent`;
  - handoff/medical safety pauses the bot and responds with handoff text;
  - FAQ/question returns a grounded response.
- The workflow must not ask for patient admin data before a concrete slot is offered, preserving the current sales-oriented flow.

Configuration:
- Default local behavior should remain deterministic/rule-based.
- OpenAI mode should be opt-in through environment configuration.
- Required OpenAI configuration should be validated at startup when OpenAI mode is selected.
- Model name should be configurable by environment so it can be upgraded without code changes.

Audit:
- Audit the interpreter provider, intent, confidence, and extracted entities.
- Do not persist raw model reasoning.
- Keep existing audit events for workflow actions.

Prompt and data safety:
- Treat the patient message as untrusted input. The model instructions must make clear that patient text cannot override clinic rules, safety rules, or system behavior.
- Send only the minimum clinic profile summary needed for interpretation and FAQ grounding.
- Do not include secrets, OAuth tokens, Kapso credentials, calendar event internals, or database identifiers that the model does not need.

## Structured Output Contract

The model should return a strict JSON object similar to:

```json
{
  "intent": "book",
  "confidence": 0.87,
  "serviceName": "Botox",
  "professionalPreference": "Dra. Perez",
  "timePreference": "semana que viene a la tarde",
  "normalizedTimePreference": {
    "from": "2026-06-01T12:00:00.000Z",
    "to": "2026-06-07T23:59:59.999Z",
    "daypart": "afternoon"
  },
  "requestedTopics": ["price"],
  "patientFullName": null,
  "requiresHuman": false,
  "safetyReason": null,
  "replyGuidance": "Mention configured price and then offer to search afternoon slots."
}
```

The implementation can refine field names, but it must keep the separation between interpretation and side effects. It should validate this object with Zod or an equivalent runtime schema before the workflow uses it.

## Data Flow

1. Patient sends a WhatsApp message.
2. Kapso webhook normalizes the message.
3. `WhatsAppInboundService` handles durable idempotency.
4. `ConversationWorkflow` loads patient/conversation state.
5. The interpreter receives:
   - patient message;
   - current pending booking state;
   - minimal clinic profile service/professional summary;
   - safety instructions.
6. The interpreter returns structured understanding.
7. Workflow validates that output against deterministic rules and maps clean preferences to configured services, professionals, and slot-search ranges.
8. If booking/reschedule/cancel/confirm is appropriate, existing scheduling workflows run.
9. If FAQ/question is appropriate, Momentum sends a grounded answer.
10. If medical/sensitive/low confidence, Momentum hands off to reception in the same WhatsApp chat.

## Error Handling

- If OpenAI is unavailable, times out, or returns invalid structured output, Momentum should use the rule-based fallback or a safe handoff depending on context.
- Model calls should have a short timeout suitable for WhatsApp response latency. Timeout values are implementation details, but tests must prove the fallback path does not create appointments.
- Invalid service extraction should not invent a treatment; the workflow should ask which configured treatment the patient wants.
- Low confidence should not trigger appointment side effects.
- Missing clinic profile data should produce a safe "no tengo ese dato configurado" response.
- Medical/safety classification should override booking/question intent.
- All model failures should be auditable without exposing internal prompts to the patient.

## Testing Requirements

Tests must cover:
- structured interpretation of realistic mixed Spanish messages;
- typo and synonym handling for common service requests;
- price/preparation/restriction answers grounded in `ClinicProfile`;
- no hallucinated price when price is missing;
- medical/personalized advice routes to handoff;
- extracted time/professional preferences affect offered slots when they map cleanly to configured data;
- booking still requires an offered slot and confirmation;
- required patient data is still requested only after slot confirmation;
- rule-based fallback remains available;
- invalid/failed OpenAI responses do not create appointments;
- full suite, typecheck, and Prisma validation pass.

An eval fixture should also be added for representative patient messages. It can run locally as deterministic tests using a fake model response first, then later against live OpenAI in a manual/eval command.

## Acceptance Criteria

- Realistic WhatsApp messages can be interpreted better than the current keyword parser.
- The model cannot directly execute calendar or WhatsApp side effects.
- FAQ answers are grounded in clinic profile data.
- A patient asking for "tarde", a date, or a named professional gets slot offers filtered when that preference is available and valid.
- Medical/sensitive requests hand off to a human.
- Existing booking, rescheduling, cancellation, Kapso, Google Calendar, and Prisma persistence tests remain compatible.
- OpenAI mode is configurable and rule-based mode remains the default fallback.
- The implementation does not expand into dashboard, onboarding UI, or full agent tool-calling.

## Sources

- OpenAI Structured Outputs guide: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Function Calling guide: https://platform.openai.com/docs/guides/function-calling
- OpenAI Agent Evals guide: https://platform.openai.com/docs/guides/agent-evals
