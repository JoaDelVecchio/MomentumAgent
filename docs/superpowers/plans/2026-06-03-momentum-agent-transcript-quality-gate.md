# Momentum Agent Transcript Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and verified on 2026-06-03.

**Goal:** Add transcript-level quality gates that verify Momentum's agent across realistic multi-turn conversations.

**Architecture:** Keep production code unchanged. Add reusable transcript fixtures and a workflow eval test that asserts patient-facing responses, router actions, pending state, appointment state, and safety outcomes.

**Tech Stack:** TypeScript, Vitest-compatible local runner, existing in-memory repositories, `ConversationWorkflow`, `SchedulingService`, and `FakeCalendar`.

---

## Tasks

### Task 1: Add Transcript Eval Fixture

**Files:**
- Create: `tests/fixtures/momentum-agent-transcripts.ts`

- [x] Define transcript cases for booking + FAQ + patient data, reschedule + refinement, medical safety, low-confidence confirmation, and contextual fallback.
- [x] Keep cases declarative so production traces can later be copied into this fixture.

### Task 2: Add Transcript Eval Runner

**Files:**
- Create: `tests/momentum-agent-transcript-evals.test.ts`

- [x] Build a reusable test context with in-memory repositories, fake calendar, audit log, and sequence interpreter.
- [x] For each transcript turn, send the patient message through `ConversationWorkflow`.
- [x] Assert expected reply fragments, selected `agent.decision` action, pending booking, appointments, and paused state.

### Task 3: Verify

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/momentum-agent-transcript-evals.test.ts
```

Result: 5 transcript evals passed.

Then run the broader conversational suite:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/conversation-agent-state.test.ts tests/conversation-agent-router.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts tests/momentum-conversational-agent-phase-1.test.ts tests/momentum-agent-transcript-evals.test.ts tests/openai-conversation-interpreter.test.ts tests/conversation-interpreter.test.ts tests/conversation-agent-decisions.test.ts
```

Result: 71 selected tests passed.
