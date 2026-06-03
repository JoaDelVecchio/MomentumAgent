# Momentum Agent Excellence Audit

Date: 2026-06-03
Status: Operator-approved execution track

## Executive Summary

Momentum's conversational agent is the core product surface. It must behave like a high-end AI receptionist with clinical-business context, not like a menu bot. The current architecture has the right direction after Phase 2: structured understanding, explicit state, an allowlisted decision router, deterministic side effects, and audit traces.

The next level is not a single prompt change. It is a quality system:

- canonical conversation state;
- model interpretation constrained to structured output;
- deterministic action policy;
- grounded response composition;
- WhatsApp Flow decisions for structured data;
- transcript and trace evaluations;
- production trace review and continuous regression gates.

## Research Notes

OpenAI's current agent guidance frames agents as workflows with models, tools, guardrails, knowledge, logic, evals, and trace grading. The useful takeaway for Momentum is that an agent should be optimized as a workflow, not just a prompt. Relevant OpenAI docs:

- Agents overview: https://platform.openai.com/docs/guides/agents
- Agent evals: https://platform.openai.com/docs/guides/agent-evals
- Trace grading: https://platform.openai.com/docs/guides/trace-grading
- Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Function calling: https://platform.openai.com/docs/guides/function-calling

For WhatsApp Flows, the practical pattern is to use flows only when structured input improves reliability: patient data, slot selection, service selection, cancellation details, or reschedule choices. Kapso's current flow docs describe data exchange, flow tokens, and completion payloads:

- Kapso WhatsApp Flow data endpoint: https://docs.kapso.ai/docs/whatsapp/flows/data-endpoint
- Kapso sending flows: https://kapso.mintlify.app/docs/whatsapp/flows/sending-flows

## Current Strengths

- The model is used for structured understanding, not direct side effects.
- The app owns calendar actions through deterministic scheduling services.
- Medical and low-confidence side-effect cases are guarded.
- Pending bookings now survive smalltalk, service catalog questions, FAQs, and slot refinements.
- The new `AgentDecisionRouter` gives each message one auditable next action.

## Gaps To Close

### 1. Evaluation Coverage

Current tests cover important unit and workflow cases, but top-tier quality requires transcript-level evals grouped by real patient journeys. These evals should assert:

- final patient-facing response;
- action selected per turn;
- pending booking state;
- patient data mutations;
- appointment mutations;
- bot pause state;
- forbidden side effects.

### 2. Conversation Memory

The Phase 2 state is derived from current repository records. It does not yet persist recent turns, summaries, last unresolved patient question, or last agent action. That will limit nuanced multi-turn behavior.

### 3. Response Composition

Responses are still mostly deterministic strings. That is safe, but can feel rigid. The target is a grounded composer: deterministic facts and action result data, with optional model-assisted wording only for non-sensitive copy.

### 4. WhatsApp Flow Policy

The router has no explicit flow action yet. Flow decisions should be first-class actions, not hidden inside reply text.

### 5. Production Feedback Loop

Audit logs exist, but there is no quality dashboard or trace grading workflow. The next system should convert real traces into eval cases.

## Target Architecture

Momentum should converge on this pipeline:

1. Intake: normalize inbound channel events.
2. Context builder: load profile, patient, active appointments, pending booking, recent turns, and last action.
3. Understanding: structured model output with service/time/professional/topic/patient data/safety fields.
4. State reducer: update canonical state.
5. Decision router: choose one allowlisted action.
6. Tool executor: call scheduling, WhatsApp Flow, messaging, handoff, or outbound services.
7. Response composer: produce grounded Spanish copy from state and tool results.
8. Trace/eval layer: record and evaluate the full path.

## Quality Bar

The agent is not "top" until it passes these gates:

- no side-effect action without high confidence and preconditions;
- no medical advice or eligibility decision;
- no hallucinated service, price, restriction, insurance, payment, or slot;
- no loss of pending booking context during side questions;
- no generic menu fallback while a specific stage is active;
- correct action trace for every turn;
- transcript evals for booking, FAQ, refinement, data collection, confirmation, cancellation, reschedule, safety, handoff, low confidence, and flow triggers;
- production failures become eval fixtures before fixes ship.

## Immediate Implementation Decision

The next implementation block is `Momentum Agent Transcript Quality Gate`.

It adds multi-turn transcript evals that exercise the agent as a workflow. This is the highest-leverage next step because it prevents future prompt/router/workflow changes from regressing the behavior that makes the agent feel intelligent.
