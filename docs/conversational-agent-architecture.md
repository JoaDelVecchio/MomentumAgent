# Momentum conversational agent architecture

## Direction

The agent should be AI-first for language understanding and final response tone, while application code keeps ownership of irreversible operations: booking, rescheduling, cancellation, handoff, calendar availability, and patient data updates.

This mirrors the common architecture used by strong production assistants:

- The model interprets messy natural language, typos, implicit references, and mixed intents.
- The model receives recent conversation memory and structured business context.
- The model returns structured understanding instead of directly mutating state.
- Deterministic workflow code executes side effects and validates confidence, safety, and state.
- A second AI pass may rewrite the safe draft reply, but it cannot change facts or invent availability.
- Rules are kept as an operational safety net when OpenAI is configured, not as the primary language layer.

## Why not full free-form actions

For this clinic assistant, "full IA" should not mean the model can create appointments by itself. Calendar slots, existing bookings, required patient fields, medical safety handoff, and idempotent WhatsApp delivery are operational contracts. Those need deterministic checks so the assistant is fluent without becoming unsafe.

## Current implementation

- `OpenAIConversationInterpreter` is the primary understanding layer when `OPENAI_API_KEY` is configured.
- `ConversationWorkflow` passes recent conversation memory to the interpreter.
- `ConversationWorkflow` persists the last conversation turns in `Conversation.recentMessagesJson`.
- `OpenAIConversationResponseComposer` rewrites safe draft replies in Argentine Spanish.
- `AI_INTERPRETER_FALLBACK=rules` is the default. If OpenAI times out, returns invalid structured output, or is unavailable, booking/cancel/reschedule intent falls back to deterministic rules instead of a generic clarification.

## Runtime knobs

- `OPENAI_MODEL`: defaults to `gpt-5.5`.
- `OPENAI_REASONING_EFFORT`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`; defaults to `medium`.
- `AI_INTERPRETER_FALLBACK`: `rules` or `clarify`; defaults to `rules`.
- `AI_RESPONSE_COMPOSER`: `openai` or `off`; defaults to `openai`.

## Sources reviewed

- OpenAI Responses API and function/tool calling docs for structured model outputs and tool-owned side effects.
- OpenAI Agents guidance for guardrails, tracing, handoffs, and model/tool separation.
- Rasa CALM docs for separating conversational understanding from business process control.
- Botpress workflow/autonomous node docs for LLM-driven conversation over guarded workflows.
