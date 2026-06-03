# Momentum Conversational Agent Phase 2 Design

Date: 2026-06-03
Status: Approved by operator override

## Summary

Phase 1 protected pending offers from obvious non-transactional replies and slot refinements. That fixes visible failures, but the agent still behaves too much like a sequence of menu branches.

Phase 2 introduces an explicit conversation state snapshot and an allowlisted decision router. The model can interpret natural language, but Momentum application code decides the next safe action from business context, patient state, pending bookings, appointment state, and safety policy.

## Problem

The current workflow decides with a linear chain of conditionals. That makes behavior hard to reason about as cases grow:

- smalltalk, FAQ, booking, confirmation, patient-data collection, cancellation, and reprogramming compete inside one method;
- OpenAI receives `pendingBooking` but not a named stage or action context;
- audit logs record detected intent but not the action the agent chose;
- transcript quality cannot be measured by checking the action plan behind each reply;
- fallback copy still sounds like a menu instead of a context-aware receptionist.

## Goals

- Build a canonical `ConversationState` snapshot for each inbound message.
- Route every inbound message to one allowlisted `AgentAction`.
- Audit the chosen action, stage, and reason before execution.
- Pass the state snapshot to the OpenAI interpreter so it can classify messages in context.
- Keep calendar, WhatsApp, and outbound side effects controlled by deterministic application code.
- Preserve existing `pendingBooking` behavior and outbound compatibility.
- Add tests for router behavior and the trace emitted by the workflow.

## Non-Goals

- No database migration for long-term memory in this phase.
- No autonomous model tool-calling.
- No WhatsApp Flow API integration yet.
- No outbound campaign rewrite yet.
- No free-form model-authored side-effect decisions.

## Architecture

Add two small application modules:

- `agent-state.ts`: derives a compact stage from the persisted conversation, pending booking, patient data, clinic profile, and active appointment count.
- `agent-router.ts`: maps `ConversationState` + structured understanding + message text to one allowlisted action.

`ConversationWorkflow` will call the router before executing side-effect branches. The switch remains in the workflow for now, but the decision object becomes the source of truth for which branch runs.

## Conversation State

The Phase 2 state snapshot contains:

- `stage`: `paused`, `idle`, `offering_slot`, `rescheduling`, `collecting_patient_data`, `booked`, or `needs_handoff`;
- `hasPendingBooking`;
- `pendingBookingKind`: `new_booking`, `reschedule`, or `none`;
- `selectedServiceId`;
- `selectedProfessionalId`;
- `offeredSlotStartsAt`;
- `missingPatientFields`;
- `activeAppointmentCount`;
- `lastPatientMessage`.

This is intentionally derived instead of persisted. A later phase can add conversation summaries and last action persistence when the Prisma model is ready.

## Agent Actions

The router returns one action:

- `handoff`
- `reply_non_transactional`
- `answer_pending_faq`
- `complete_pending_patient_data`
- `clarify_low_confidence`
- `refine_pending_slot`
- `search_slots`
- `confirm_pending_booking`
- `cancel_appointment`
- `reschedule_appointment`
- `answer_faq`
- `reply_contextual_fallback`

Every action has preconditions in code. The model cannot create a new action at runtime.

## OpenAI Context

The OpenAI interpreter payload should include the state snapshot, not just raw `pendingBooking`. This lets the model classify phrases such as "si", "mejor el viernes", "cuanto sale", "soy Ana Gomez", or "hablo con alguien" according to the current stage.

## Testing

Add unit tests for the state builder and router, plus workflow tests that verify `agent.decision` audit events. Existing transcript tests continue to prove behavior from the patient side.

## Acceptance Criteria

- Every inbound message produces an auditable agent decision.
- Pending booking, FAQ, patient-data, low-confidence, confirm, cancel, and reschedule branches are selected through the router.
- The OpenAI payload includes `conversationState`.
- Existing Phase 1 transcript tests keep passing.
- No production side effect is delegated to the model.
