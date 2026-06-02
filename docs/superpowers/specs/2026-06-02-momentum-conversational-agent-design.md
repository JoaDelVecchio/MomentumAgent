# Momentum Conversational Agent Design

Date: 2026-06-02
Status: Draft for user review

## Summary

Momentum needs a conversational agent that behaves like a high-quality AI receptionist for aesthetic clinics, not like an isolated intent classifier. The agent must understand the whole conversation, use the clinic business context, track patient and booking state, decide the next best action, and execute only safe, allowed tools.

This design defines the target architecture and implementation phases for the Momentum Conversational Agent. It is intentionally broader than the current Test Mode bug, but it keeps implementation incremental through small, testable blocks.

## Current Problem

The current conversation flow can handle simple single-message booking requests, but it is brittle in realistic chat:

- It interprets each message mostly in isolation.
- It passes only minimal `pendingBooking` context into the AI interpreter.
- It can confuse smalltalk or questions with booking confirmation.
- It does not have an explicit action router for when to reply, show a WhatsApp Flow, book, reschedule, cancel, remind, wait, or hand off.
- Test Mode dry-run confirmation can return a false "slot unavailable" message because real event creation is intentionally blocked.
- The test suite covers useful unit cases, but not enough full conversation transcripts.

## Goals

- Understand multi-turn WhatsApp/Test Mode conversations with business context.
- Maintain explicit conversation state: selected service, offered slot, pending patient fields, active appointment, bot pause, last action, and unresolved questions.
- Decide the next action using deterministic business policy plus AI understanding.
- Use clinic profile data for services, prices, preparation, restrictions, professionals, payment/insurance notes, opening rules, and handoff policy.
- Know when to show WhatsApp Flows for structured data collection.
- Know when to search availability, offer slots, confirm bookings, reprogram, cancel, or request missing data.
- Keep medical, eligibility, adverse symptom, and ambiguous high-risk cases under safe human handoff.
- Keep Test Mode as dry-run while still allowing realistic end-to-end conversation verification.
- Build an evaluation suite from realistic transcripts so quality can be measured over time.

## Non-Goals

- No unrestricted autonomous calendar mutation.
- No medical diagnosis, eligibility decisions, or personalized treatment recommendations.
- No free-form tool execution chosen directly by the model.
- No replacement for human reception in safety-sensitive or uncertain cases.
- No single large rebuild of the whole backend.

## Recommended Approach

Use a layered agent architecture:

1. **Conversation Intake** receives WhatsApp/Test Mode messages, normalizes metadata, and attaches a stable conversation identity.
2. **Context Builder** loads the clinic profile, patient record, active appointment state, pending booking, recent turns, and business rules.
3. **Understanding Layer** asks AI for structured understanding of the current message in conversation context.
4. **State Reducer** updates a canonical conversation state from previous state plus the new understanding.
5. **Decision Router** chooses the next safe action from an allowlist.
6. **Tool Execution Layer** executes calendar, WhatsApp Flow, messaging, reminder, or handoff tools under application rules.
7. **Response Composer** returns patient-facing Spanish copy grounded in tool results and clinic context.
8. **Audit and Evaluation Layer** records traces and runs transcript-level tests.

The model can interpret and propose, but application code decides and executes.

## Core Concepts

### Conversation State

The agent should store a compact state object per conversation:

- `stage`: `idle`, `selecting_service`, `offering_slot`, `collecting_patient_data`, `booking_ready`, `booked`, `rescheduling`, `cancelling`, `handoff`, or `paused`.
- `selectedServiceId`
- `selectedProfessionalId`
- `timePreference`
- `offeredSlot`
- `activeAppointmentId`
- `missingPatientFields`
- `lastPatientQuestion`
- `lastAgentAction`
- `botPaused`
- `conversationSummary`

This state lets the agent understand "si", "a la tarde", "cuanto sale", "como te llamas", or "mejor manana" in context.

### Structured Understanding

The AI interpreter should return structured output, not final actions:

- user intent candidates;
- confidence;
- requested service;
- requested topics;
- time preference;
- professional preference;
- patient data provided;
- whether the patient is accepting, rejecting, refining, or asking about a pending offer;
- safety/handoff reasons;
- whether a WhatsApp Flow would help collect structured data.

The interpreter receives the current message, recent turns, conversation summary, state, clinic profile, patient context, and current date/time.

### Decision Router

The router chooses one next action:

- `reply`
- `answer_faq`
- `show_services`
- `search_slots`
- `offer_slot`
- `refine_slot`
- `collect_patient_data`
- `start_whatsapp_flow`
- `book_appointment`
- `reschedule_appointment`
- `cancel_appointment`
- `send_reminder`
- `handoff`
- `pause`
- `no_op_wait`

Every action has preconditions. For example, `book_appointment` requires a selected service, offered slot, required patient fields, high-confidence acceptance, and safe runtime mode.

### WhatsApp Flows

WhatsApp Flows should be used when structured input improves reliability:

- collecting full name and required patient fields;
- choosing among multiple services;
- choosing among multiple available slots;
- confirming or changing an offered slot;
- collecting cancellation or reprogramming details;
- clinic onboarding or setup flows for internal/admin cases.

Flows should not be shown for simple answers, smalltalk, or questions that can be answered from clinic profile context.

### Scheduling

The agent should distinguish:

- searching availability;
- offering a slot;
- refining an offered slot;
- confirming a pending slot;
- booking the actual appointment;
- reprogramming an existing appointment;
- cancelling an existing appointment.

Test Mode must simulate confirmation without creating real calendar events, while production may create events only after all preconditions pass.

### Outbound Intelligence

Outbound behavior should be integrated after the inbound brain is stable:

- reminders before appointments;
- no-show follow-up;
- reactivation campaigns;
- freed-slot messages;
- incomplete booking nudges;
- post-treatment follow-up if configured.

Outbound messages should use the same context and policy layer so they do not conflict with active conversations.

## Safety and Policy

- Medical safety language always routes to handoff.
- The agent must not diagnose, recommend treatment for a personal case, or decide medical eligibility.
- Low-confidence side-effect actions do not execute.
- Calendar mutation only happens through application tools with explicit preconditions.
- The model cannot override tool policy, runtime safety, clinic setup, or dry-run mode.
- Unknown configured facts produce a safe "not configured" answer or handoff, not invented data.

## Test Mode Behavior

Test Mode should behave like a real conversation console:

- stable test identity across turns;
- visible transcript;
- explicit dry-run label;
- real availability lookup;
- no real calendar event creation;
- simulated success for dry-run confirmation;
- trace panel showing state, understanding, decision, and tool result;
- ability to restart conversation.

The reproduction below becomes an evaluation:

1. Patient: "Hola, quiero reservar botox."
2. Momentum: offers a Botox slot.
3. Patient: "como te llamas"
4. Momentum: explains its role without confirming or losing the slot.
5. Patient: "que servicios ofrecen"
6. Momentum: lists configured services without losing the slot.
7. Patient: "si"
8. Momentum: in Test Mode, dry-run confirms that the booking would be created, without creating a real event.

## Evaluation Suite

Add transcript-level evaluations grouped by behavior:

- greeting and smalltalk during pending booking;
- service catalog and FAQ;
- booking, confirmation, and missing patient data;
- slot refinement by day, time, and professional;
- rescheduling active appointments;
- cancellation;
- WhatsApp Flow selection;
- handoff and safety;
- low-confidence side-effect prevention;
- outbound reminder and reactivation policy;
- Test Mode dry-run correctness.

Each evaluation should assert final patient-facing response, state changes, chosen action, and absence of forbidden tool calls.

## Implementation Phases

### Phase 1: Evaluation Harness and Trace Shape

Create transcript-level tests and an internal trace shape for understanding, state, decision, and tool result. Add the known failing Test Mode transcript as the first red evaluation.

### Phase 2: Agent Brain v1

Extend the interpreter input with conversation state, recent turns, and clinic context. Extend structured output to distinguish smalltalk, service catalog, pending-offer questions, slot refinement, acceptance, rejection, and patient data.

### Phase 3: State Reducer and Decision Router

Introduce explicit state transitions and allowlisted actions. Protect pending offers from unrelated questions. Prevent side effects unless preconditions pass.

### Phase 4: Scheduling and Test Mode Correctness

Separate search, offer, refine, confirm, book, reschedule, and cancel actions. Make Test Mode simulate confirmation without creating real calendar events.

### Phase 5: WhatsApp Flows

Add flow decision support and flow start actions for service selection, slot selection, patient data, confirmation, cancellation, and reprogramming.

### Phase 6: Outbound Intelligence

Unify reminders, no-show follow-up, reactivation, freed slots, and incomplete booking nudges with the same state and policy model.

### Phase 7: Quality Hardening

Add more production-style transcripts, trace review, prompt/version tracking, regression tests, and quality score reporting.

## Acceptance Criteria

- The agent understands multi-turn conversations in Test Mode and WhatsApp.
- Questions and smalltalk do not destroy pending booking state.
- The agent answers service catalog and FAQ from configured clinic data.
- Slot refinement works after an offered slot.
- Test Mode dry-run never creates real events and never lies that a blocked dry-run event is unavailable.
- Production booking, rescheduling, and cancellation execute only when preconditions pass.
- WhatsApp Flow decisions are explicit and testable.
- Outbound messages respect active conversation state.
- Medical and uncertain side-effect cases safely hand off.
- Transcript-level evaluations cover the critical workflows.

## First Implementation Block

The first child spec should be:

`Momentum Conversational Agent Phase 1: Evaluation Harness and Inbound Brain v1`

It should implement the failing Test Mode transcript, the new state/decision trace shape, and the minimum router changes needed to protect pending bookings and answer service catalog questions correctly.
