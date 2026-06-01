# Conversational Test Mode and OpenAI Interpreter Design

Date: 2026-06-01
Status: Draft for user review

## Summary

The current internal Test Mode proves that Momentum can read real Google Calendar availability, but it behaves like a one-message probe. Because every browser run starts a new isolated test identity unless explicit identifiers are supplied, it is not useful for validating a multi-turn receptionist conversation.

This block turns Test Mode into a WhatsApp-like internal conversation console and makes it use the same AI interpreter path intended for production WhatsApp when OpenAI is configured.

## Goals

- Let the Momentum team test a realistic multi-message conversation before connecting Kapso/WhatsApp.
- Keep one stable test conversation identity while the operator sends multiple messages.
- Show a visible chat history with patient messages and Momentum replies.
- Add a `New conversation` action that rotates to a fresh safe test identity.
- Keep Google Calendar as the real availability source.
- Keep Test Mode as a dry-run: it can read availability and conversation state, but it must not create, update, or cancel real calendar events.
- Use OpenAI intent interpretation in Test Mode when `AI_INTERPRETER_PROVIDER=openai` is configured.
- Fall back safely to deterministic rules if OpenAI fails or returns unusable structured output.

## Non-Goals

- No real WhatsApp/Kapso traffic in this block.
- No real calendar event creation from Test Mode.
- No reminders, reactivation, freed-slot outbound, or production cron changes.
- No login system or role-based admin users.
- No persistent browser-independent test transcript viewer.
- No customer-facing dashboard changes.

## Product Behavior

The internal page `/internal/onboarding/clinics/:clinicId/test` becomes a chat console.

When the page loads, it creates a test session identity in the browser:

- `conversationId`: `test:<clinicId>:<uuid>`;
- `patientId`: `test_patient:<clinicId>:<uuid>`;
- `whatsappNumber`: `+549000<digits>`.

Every message sent from that page includes those identifiers. This makes the backend reuse the same conversation, pending booking state, bot pause state, and test patient across multiple turns.

The `New conversation` button clears the visible thread and generates a new identity. This lets the operator start over without colliding with previous test patients in Neon.

## Example Workflow

1. Operator opens Test Mode and enters the admin token.
2. Operator sends: `Hola`.
3. Momentum replies with a helpful receptionist-style prompt.
4. Operator sends: `Quiero reservar botox`.
5. Momentum reads the configured clinic profile and Google Calendar availability.
6. Momentum replies with an available slot.
7. Operator sends: `Tenes algo a la tarde?`.
8. Momentum uses conversation context plus AI interpretation to look for a better time preference.
9. Operator clicks `New conversation` to reset the test identity and visible transcript.

## AI Interpreter Design

Test Mode should not hardcode `RulesConversationInterpreter`. It should accept an injected `ConversationInterpreter`, defaulting to rules for unit tests and local development.

Production runtime should build one shared interpreter strategy:

- if `AI_INTERPRETER_PROVIDER=rules`, use `RulesConversationInterpreter`;
- if `AI_INTERPRETER_PROVIDER=openai`, use `OpenAIConversationInterpreter`;
- wrap OpenAI with a rules fallback so an API timeout, invalid structured response, or adapter fallback does not make the conversation unusable.

The OpenAI interpreter remains limited to structured understanding. It must not claim that a calendar slot exists, diagnose, decide medical eligibility, expose secrets, or override application rules. Slot selection, booking state, handoff, and dry-run protection stay in application code.

## Backend Design

Reuse the existing route:

- `POST /internal/onboarding/clinics/:clinicId/test-message`

The route already accepts optional `conversationId`, `patientId`, and `whatsappNumber`. That contract stays.

Server-generated default identities remain in place for direct API calls that do not provide identifiers. The browser chat console will provide identifiers so multi-turn state is preserved.

`OnboardingTestModeService` keeps using `DryRunCalendar`, so confirmation paths cannot create, update, or cancel Google Calendar events.

## Frontend Design

The Test Mode page should show:

- admin token field;
- current test conversation status;
- scrollable message thread;
- patient/Momentum message bubbles;
- text composer;
- `Send` button;
- `New conversation` button;
- clear dry-run copy, such as `Dry-run: reads calendar availability but does not create events`.

The visible transcript can live in React state only. A page refresh may start with a new empty transcript. This keeps the block small and avoids building a test transcript database before it is needed.

## Error Handling

- Missing admin token: disable send and show a short status.
- Unauthorized admin token: show the API error in the status area.
- Unsafe test identity rejected by backend: clear the current test session and ask the operator to start a new conversation.
- Calendar or profile not configured: show the backend response, do not mark the test as passed.
- OpenAI failure: log/audit through existing paths where available, then use rules fallback.
- Handoff result: show the handoff message and mark the thread as paused; subsequent sends should either be blocked in the UI or clearly show that reception has taken over.

## Testing Strategy

Backend tests:

- `OnboardingTestModeService` uses an injected interpreter when provided.
- OpenAI fallback strategy returns rules interpretation when the OpenAI adapter returns provider `fallback`.
- Existing dry-run calendar tests still prove Test Mode does not create real appointments or events.
- Existing route tests still prove default identities are fresh for one-off browser runs.

Frontend tests or manual verification:

- sending two messages from the page uses the same test identity;
- `New conversation` rotates identity and clears the visible thread;
- a booking request still returns a real Google Calendar slot in production;
- an occupied Google Calendar slot is skipped;
- a safety-sensitive medical message produces handoff behavior.

## Acceptance Criteria

- The Test Mode page works like a simple internal chat, not a single-message form.
- Multiple messages in one test session preserve conversation state.
- `New conversation` starts a clean test session without database uniqueness collisions.
- Test Mode uses OpenAI interpretation in production when the OpenAI env vars are configured.
- Rules mode still works when OpenAI is not configured.
- OpenAI failures do not break the test conversation.
- Google Calendar availability remains real.
- Test Mode remains dry-run and does not create real Google Calendar events.
- The repo has automated coverage for the interpreter injection/fallback behavior and test identity behavior.
