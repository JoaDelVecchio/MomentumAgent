# Momentum Conversational Agent Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit conversation state and allowlisted action routing so Momentum behaves like a contextual AI receptionist instead of a menu bot.

**Architecture:** Derive a `ConversationState` snapshot per inbound message, route structured understanding to an `AgentDecision`, audit that decision, pass the state to OpenAI, and keep all side effects inside existing workflow methods.

**Tech Stack:** TypeScript, Zod, existing `ConversationWorkflow`, existing repository ports, local custom test runner for this environment.

---

### Task 1: Add Conversation State Snapshot

**Files:**
- Create: `src/application/conversations/agent-state.ts`
- Test: `tests/conversation-agent-state.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `tests/conversation-agent-state.test.ts` with cases for idle, paused, pending new booking, pending reschedule, collecting patient data, and booked stages.

- [ ] **Step 2: Run red test**

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/conversation-agent-state.test.ts
```

Expected: FAIL because `agent-state.ts` does not exist.

- [ ] **Step 3: Implement `buildConversationState`**

Create `src/application/conversations/agent-state.ts` with exported `ConversationStage`, `ConversationState`, and `buildConversationState`.

- [ ] **Step 4: Run green test**

Run the same command. Expected: all state tests pass.

### Task 2: Add Allowlisted Agent Router

**Files:**
- Create: `src/application/conversations/agent-router.ts`
- Test: `tests/conversation-agent-router.test.ts`

- [ ] **Step 1: Write failing router tests**

Cover handoff, non-transactional reply, pending FAQ, patient data, low-confidence side effects, slot refinement, book/search, confirm, cancel, reschedule, FAQ, and contextual fallback.

- [ ] **Step 2: Run red test**

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/conversation-agent-router.test.ts
```

Expected: FAIL because `agent-router.ts` does not exist.

- [ ] **Step 3: Implement router**

Implement `decideAgentAction` with an allowlisted `AgentActionType` union and deterministic preconditions.

- [ ] **Step 4: Run green test**

Run the same command. Expected: all router tests pass.

### Task 3: Wire Router Into Workflow

**Files:**
- Modify: `src/application/conversations/conversation-workflow.ts`
- Test: `tests/conversation-workflow.test.ts`
- Test: `tests/momentum-conversational-agent-phase-1.test.ts`

- [ ] **Step 1: Add workflow audit test**

Add an assertion that an inbound booking emits `agent.decision` metadata with stage and action.

- [ ] **Step 2: Run red workflow test**

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/conversation-workflow.test.ts
```

Expected: FAIL because no `agent.decision` audit exists.

- [ ] **Step 3: Call state builder and router**

In `ConversationWorkflow`, build state after interpreting the message, call `decideAgentAction`, audit the result, and switch on the decision action.

- [ ] **Step 4: Run green workflow tests**

Run workflow and Phase 1 tests. Expected: all selected tests pass.

### Task 4: Pass State To OpenAI

**Files:**
- Modify: `src/application/conversations/interpreter.ts`
- Modify: `src/adapters/openai/openai-conversation-interpreter.ts`
- Test: `tests/openai-conversation-interpreter.test.ts`

- [ ] **Step 1: Add failing OpenAI payload assertion**

Assert the fake OpenAI client receives `conversationState.stage` and pending slot summary.

- [ ] **Step 2: Run red OpenAI test**

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/openai-conversation-interpreter.test.ts
```

Expected: FAIL because payload lacks `conversationState`.

- [ ] **Step 3: Add optional `conversationState` to interpreter input and payload**

Update the interpreter contract and payload builder.

- [ ] **Step 4: Run green OpenAI tests**

Run the same command. Expected: all OpenAI interpreter tests pass.

### Task 5: Verify And Commit

**Files:**
- All files above.

- [ ] **Step 1: Run focal verification**

Run:

```bash
node --loader ./.tmp/verify-runner/loader.mjs ./.tmp/verify-runner/run-tests.mjs tests/conversation-agent-state.test.ts tests/conversation-agent-router.test.ts tests/conversation-workflow.test.ts tests/momentum-conversational-agent-phase-1.test.ts tests/openai-conversation-interpreter.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run syntax check**

Run TypeScript `transpileModule` syntax check for touched files.

- [ ] **Step 3: Commit and push**

Stage only scoped files, commit with:

```bash
/usr/bin/git commit -m "feat: add conversational agent decision router"
```

Push:

```bash
/usr/bin/git push origin main
```
