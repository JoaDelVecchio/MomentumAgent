# Clinic Receptionist Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Superpowers execution workflow if available. In this session the Superpowers plugin is not callable, so follow the repository fallback in `AGENTS.md`: implement task-by-task with RED-GREEN-REFACTOR and keep changes scoped.

**Status:** Ready for implementation.

**Approved Design:** `docs/superpowers/specs/2026-06-04-clinic-receptionist-agent-design.md`

**Goal:** Refactor Momentum's conversational core into a clinic receptionist agent that talks naturally within the clinic reception role, uses onboarding data as business truth, and operates calendar workflows only through validated application-side actions.

**Architecture:** Add a `ReceptionistAgent` contract, an OpenAI adapter returning structured turns, an application-side action policy, and workflow integration. Keep existing repositories, scheduling service, calendar ports, onboarding/test mode, audit log, and recent-message persistence.

**Tech Stack:** TypeScript, Zod, OpenAI Responses API, existing Vitest suite.

---

## Task 1: Add Receptionist Agent Contract

**Files:**
- Create: `src/application/conversations/receptionist-agent.ts`
- Test: `tests/receptionist-agent-contract.test.ts`

- [ ] Write failing tests for parsing proposed receptionist turns, including `reply_only`, `search_slots`, `confirm_pending_booking`, `handoff`, and null optional fields.
- [ ] Run red test:

```bash
npx vitest run tests/receptionist-agent-contract.test.ts
```

Expected: fails because the contract module does not exist.

- [ ] Implement exported types and Zod parser:
  - `ReceptionistProposedAction`
  - `ReceptionistTurn`
  - `ReceptionistAgentInput`
  - `ReceptionistAgent`
  - `parseReceptionistTurn`
- [ ] Run green test:

```bash
npx vitest run tests/receptionist-agent-contract.test.ts
```

Expected: all contract tests pass.

## Task 2: Add Action Policy Guardrails

**Files:**
- Create: `src/application/conversations/receptionist-action-policy.ts`
- Test: `tests/receptionist-action-policy.test.ts`

- [ ] Write failing tests for:
  - explicit pending booking confirmation from `agendalo`;
  - refusal to confirm from abusive/irrelevant text;
  - refusal to confirm without pending booking;
  - low-confidence side-effect downgrade;
  - calendar-safe `search_slots`;
  - handoff for medical safety;
  - patient data collection only with complete high-confidence full name.
- [ ] Run red test:

```bash
npx vitest run tests/receptionist-action-policy.test.ts
```

Expected: fails because the policy module does not exist.

- [ ] Implement `decideReceptionistAction` with proposed and final allowed action metadata.
- [ ] Run green test:

```bash
npx vitest run tests/receptionist-action-policy.test.ts
```

Expected: all policy tests pass.

## Task 3: Add OpenAI Receptionist Agent Adapter

**Files:**
- Create: `src/adapters/openai/openai-receptionist-agent.ts`
- Test: `tests/openai-receptionist-agent.test.ts`

- [ ] Write failing tests that assert:
  - instructions define the clinic receptionist role;
  - onboarding context is included without calendar IDs;
  - pending booking and recent messages are included;
  - structured output is parsed through `parseReceptionistTurn`;
  - invalid/throwing OpenAI output returns a safe fallback turn.
- [ ] Run red test:

```bash
npx vitest run tests/openai-receptionist-agent.test.ts
```

Expected: fails because the adapter does not exist.

- [ ] Implement the OpenAI adapter using the existing Responses API client style.
- [ ] Run green test:

```bash
npx vitest run tests/openai-receptionist-agent.test.ts
```

Expected: all adapter tests pass.

## Task 4: Wire Receptionist Agent Into Workflow

**Files:**
- Modify: `src/application/conversations/conversation-workflow.ts`
- Modify: `src/application/onboarding/test-mode-service.ts`
- Modify: `src/runtime/server-runtime.ts`
- Modify: `src/runtime/production-app.ts`
- Test: `tests/conversation-workflow-receptionist-agent.test.ts`
- Test: `tests/onboarding-test-mode.test.ts`
- Test: `tests/server-runtime.test.ts`
- Test: `tests/production-app-runtime.test.ts`

- [ ] Write failing workflow tests with a fake receptionist agent:
  - booking offer uses `search_slots`;
  - pending price question keeps pending slot;
  - abusive/irrelevant text does not confirm;
  - later `agendalo` confirms or asks for missing full name;
  - audit logs record proposed and final allowed receptionist action.
- [ ] Run red workflow test:

```bash
npx vitest run tests/conversation-workflow-receptionist-agent.test.ts
```

Expected: fails because workflow does not call the receptionist agent.

- [ ] Add optional `receptionistAgent` to workflow options.
- [ ] When `receptionistAgent` is provided, use it as the primary conversational path and keep the existing interpreter/router path as fallback for rules mode and old tests.
- [ ] Add test mode and runtime wiring so OpenAI provider uses the receptionist agent.
- [ ] Run green tests:

```bash
npx vitest run tests/conversation-workflow-receptionist-agent.test.ts tests/onboarding-test-mode.test.ts tests/server-runtime.test.ts tests/production-app-runtime.test.ts
```

Expected: selected workflow and runtime tests pass.

## Task 5: Add Transcript Quality Gate For Human Reception Behavior

**Files:**
- Modify: `tests/fixtures/momentum-agent-transcripts.ts`
- Modify: `tests/momentum-agent-transcript-evals.test.ts`
- Add if cleaner: `tests/fixtures/receptionist-agent-transcripts.ts`
- Add if cleaner: `tests/receptionist-agent-transcript-evals.test.ts`

- [ ] Add transcript cases for:
  - the reported Botox price plus abusive text plus later `agendalo` flow;
  - "hay mucha gente?";
  - "me voy de vacaciones, que me recomendas?";
  - nervous patient;
  - missing business fact;
  - out-of-scope general ChatGPT request;
  - medical safety handoff.
- [ ] Run red transcript test:

```bash
npx vitest run tests/receptionist-agent-transcript-evals.test.ts
```

Expected: fails until workflow integration and fake turns are complete.

- [ ] Implement fixtures and assertions for final allowed action, response fragments, pending state, and appointment mutations.
- [ ] Run green transcript test:

```bash
npx vitest run tests/receptionist-agent-transcript-evals.test.ts
```

Expected: all receptionist transcript tests pass.

## Task 6: Refactor Static Replies Toward Receptionist Voice

**Files:**
- Modify: `src/application/conversations/conversation-workflow.ts`
- Modify if useful: `src/application/conversations/response-formatting.ts`
- Tests:
  - `tests/conversation-workflow-receptionist-agent.test.ts`
  - `tests/receptionist-agent-transcript-evals.test.ts`

- [ ] Replace robotic fallback copy on the receptionist path with concise reception copy.
- [ ] Preserve exact operational facts from scheduling results.
- [ ] Run focal tests:

```bash
npx vitest run tests/conversation-workflow-receptionist-agent.test.ts tests/receptionist-agent-transcript-evals.test.ts
```

Expected: no menu-like fallback appears on receptionist-path tests.

## Task 7: Final Verification

**Files:**
- All touched files.

- [ ] Run focal conversational suite:

```bash
npx vitest run tests/receptionist-agent-contract.test.ts tests/receptionist-action-policy.test.ts tests/openai-receptionist-agent.test.ts tests/conversation-workflow-receptionist-agent.test.ts tests/receptionist-agent-transcript-evals.test.ts tests/conversation-agent-state.test.ts tests/conversation-agent-router.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts tests/momentum-conversational-agent-phase-1.test.ts tests/momentum-agent-transcript-evals.test.ts tests/openai-conversation-interpreter.test.ts tests/openai-conversation-response-composer.test.ts tests/onboarding-test-mode.test.ts tests/server-runtime.test.ts tests/production-app-runtime.test.ts
```

Expected: all selected tests pass.

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] Run code review pass over behavior and shared code changes before declaring complete.

## Completion Criteria

- The reported failure transcript no longer confirms on abusive/irrelevant text.
- The later explicit `agendalo` turn confirms only through policy-validated pending booking flow.
- OpenAI runtime uses the receptionist agent path.
- Rules mode and existing fallback tests remain usable.
- Every receptionist turn is auditable with proposed and final allowed action.
