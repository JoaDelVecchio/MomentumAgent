# Conversational Test Mode and OpenAI Interpreter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WhatsApp-like internal Test Mode chat that preserves multi-turn test state and uses the production OpenAI interpreter path when configured.

**Architecture:** Keep the existing `/internal/onboarding/clinics/:clinicId/test-message` route. The browser will create and reuse a safe test identity for all messages in a test session; the backend will accept an injected conversation interpreter for Test Mode and production will pass the same interpreter strategy used by WhatsApp. OpenAI interpretation will be wrapped with a rules fallback so failures do not break testing.

**Tech Stack:** TypeScript, Fastify, Next.js App Router, React state, Vitest, Prisma-backed production repositories, Google Calendar adapter, OpenAI Responses structured parsing.

---

## File Structure

- `src/application/onboarding/test-mode-service.ts`: add optional interpreter injection for Test Mode.
- `src/application/conversations/fallback-interpreter.ts`: new small interpreter wrapper that falls back from OpenAI/failing primary interpretation to rules.
- `src/runtime/server-runtime.ts`: export `buildConversationInterpreter` and use the fallback wrapper for OpenAI mode.
- `src/runtime/production-app.ts`: pass the production interpreter strategy into `OnboardingTestModeService`.
- `tests/onboarding-test-mode.test.ts`: cover interpreter injection in Test Mode.
- `tests/conversation-interpreter-fallback.test.ts`: cover fallback behavior.
- `apps/web/src/lib/test-mode-session.ts`: create safe browser-side test identities.
- `tests/web-test-mode-session.test.ts`: verify generated identities are safe and rotate.
- `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`: replace one-shot form with chat console.
- `apps/web/src/app/globals.css`: add focused internal chat styles.

## Task 1: Backend Interpreter Injection

**Files:**
- Modify: `src/application/onboarding/test-mode-service.ts`
- Modify: `tests/onboarding-test-mode.test.ts`

- [ ] **Step 1: Write failing test for interpreter injection**

Add this import to `tests/onboarding-test-mode.test.ts`:

```ts
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";
```

Add this test inside `describe("OnboardingTestModeService", () => { ... })`:

```ts
  it("uses an injected interpreter for test mode messages", async () => {
    const context = await buildContext({
      interpreter: new FixedInterpreter({
        provider: "rules",
        intent: "question",
        confidence: 0.99,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Forced question intent."
      })
    });

    const result = await context.testModeService.runMessage({
      clinicId: "clinic_setup",
      conversationId: "test:clinic_setup:interpreter",
      patientId: "test_patient:clinic_setup:interpreter",
      whatsappNumber: "+5490001111111",
      text: "Quiero reservar botox"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno."
    });
  });
```

Change the helper signature and constructor call in the same test file:

```ts
async function buildContext(options: { interpreter?: ConversationInterpreter } = {}) {
  // existing setup...
  const testModeService = new OnboardingTestModeService({
    onboarding,
    operational,
    audit,
    calendar,
    now,
    interpreter: options.interpreter
  });
  // existing setup...
}
```

Add this helper class at the end of the test file:

```ts
class FixedInterpreter implements ConversationInterpreter {
  readonly inputs: ConversationInterpreterInput[] = [];

  constructor(private readonly understanding: ConversationUnderstanding) {}

  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    this.inputs.push(input);
    return this.understanding;
  }
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/onboarding-test-mode.test.ts
```

Expected: FAIL with a TypeScript or runtime error showing `interpreter` is not accepted by `OnboardingTestModeServiceOptions`, or the forced interpreter is ignored and booking still happens.

- [ ] **Step 3: Implement interpreter injection**

In `src/application/onboarding/test-mode-service.ts`, add the interpreter type import:

```ts
import type { ConversationInterpreter } from "../conversations/interpreter.js";
```

Extend `OnboardingTestModeServiceOptions`:

```ts
  interpreter?: ConversationInterpreter;
```

Change the workflow construction:

```ts
    this.workflow = new ConversationWorkflow(
      options.operational,
      scheduling,
      options.audit,
      this.now,
      options.interpreter ?? new RulesConversationInterpreter()
    );
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/onboarding-test-mode.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/application/onboarding/test-mode-service.ts tests/onboarding-test-mode.test.ts
git commit -m "feat: inject interpreter into onboarding test mode"
```

## Task 2: OpenAI Interpreter Fallback in Runtime

**Files:**
- Create: `src/application/conversations/fallback-interpreter.ts`
- Modify: `src/runtime/server-runtime.ts`
- Modify: `src/runtime/production-app.ts`
- Test: `tests/conversation-interpreter-fallback.test.ts`
- Test: `tests/production-app-runtime.test.ts`

- [ ] **Step 1: Write failing fallback interpreter test**

Create `tests/conversation-interpreter-fallback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FallbackConversationInterpreter } from "../src/application/conversations/fallback-interpreter.js";
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";

const input: ConversationInterpreterInput = {
  clinicId: "clinic_1",
  conversationId: "conv_1",
  patientId: "pat_1",
  messageText: "Quiero reservar botox",
  now: new Date("2026-06-01T12:00:00.000Z")
};

describe("FallbackConversationInterpreter", () => {
  it("returns the primary interpretation when it is usable", async () => {
    const result = await new FallbackConversationInterpreter(
      new FixedInterpreter({
        provider: "openai",
        intent: "book",
        confidence: 0.92,
        serviceName: "Botox",
        requestedTopics: [],
        requiresHuman: false,
        reason: "OpenAI understood booking."
      }),
      new FixedInterpreter({
        provider: "rules",
        intent: "unknown",
        confidence: 0.1,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Fallback."
      })
    ).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "openai", intent: "book" }));
  });

  it("uses the fallback interpreter when the primary returns provider fallback", async () => {
    const fallback = new FixedInterpreter({
      provider: "rules",
      intent: "book",
      confidence: 0.8,
      serviceName: "Botox",
      requestedTopics: [],
      requiresHuman: false,
      reason: "Rules fallback understood booking."
    });

    const result = await new FallbackConversationInterpreter(
      new FixedInterpreter({
        provider: "fallback",
        intent: "unknown",
        confidence: 0,
        requestedTopics: [],
        requiresHuman: false,
        reason: "OpenAI failed."
      }),
      fallback
    ).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "rules", intent: "book", serviceName: "Botox" }));
    expect(fallback.calls).toBe(1);
  });

  it("uses the fallback interpreter when the primary throws", async () => {
    const fallback = new FixedInterpreter({
      provider: "rules",
      intent: "question",
      confidence: 0.8,
      requestedTopics: ["price"],
      requiresHuman: false,
      reason: "Rules fallback handled the message."
    });

    const result = await new FallbackConversationInterpreter(new ThrowingInterpreter(), fallback).interpret(input);

    expect(result).toEqual(expect.objectContaining({ provider: "rules", intent: "question" }));
    expect(fallback.calls).toBe(1);
  });
});

class FixedInterpreter implements ConversationInterpreter {
  calls = 0;

  constructor(private readonly result: ConversationUnderstanding) {}

  async interpret(): Promise<ConversationUnderstanding> {
    this.calls += 1;
    return this.result;
  }
}

class ThrowingInterpreter implements ConversationInterpreter {
  async interpret(): Promise<ConversationUnderstanding> {
    throw new Error("primary failed");
  }
}
```

- [ ] **Step 2: Run fallback test and verify it fails**

Run:

```bash
npm test -- tests/conversation-interpreter-fallback.test.ts
```

Expected: FAIL because `src/application/conversations/fallback-interpreter.ts` does not exist.

- [ ] **Step 3: Implement fallback interpreter**

Create `src/application/conversations/fallback-interpreter.ts`:

```ts
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "./interpreter.js";

export class FallbackConversationInterpreter implements ConversationInterpreter {
  constructor(
    private readonly primary: ConversationInterpreter,
    private readonly fallback: ConversationInterpreter
  ) {}

  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    try {
      const result = await this.primary.interpret(input);
      if (result.provider !== "fallback") {
        return result;
      }
    } catch {
      // Fall through to deterministic interpretation below.
    }

    return this.fallback.interpret(input);
  }
}
```

- [ ] **Step 4: Wire fallback into runtime builder**

In `src/runtime/server-runtime.ts`, import the fallback:

```ts
import { FallbackConversationInterpreter } from "../application/conversations/fallback-interpreter.js";
```

Export `buildConversationInterpreter`:

```ts
export function buildConversationInterpreter(config: AIConfig): ConversationInterpreter {
```

Change OpenAI mode to:

```ts
  return new FallbackConversationInterpreter(
    new OpenAIConversationInterpreter({
      client: new OpenAI({ apiKey: config.apiKey }),
      model: config.model,
      timeoutMs: config.timeoutMs
    }),
    new RulesConversationInterpreter()
  );
```

- [ ] **Step 5: Pass production interpreter to Test Mode**

In `src/runtime/production-app.ts`, import:

```ts
import { readAIConfig } from "../config/ai.js";
```

and add `buildConversationInterpreter` to the existing `./server-runtime.js` import.

Inside `createProductionAppRuntime`, after `summary` is built, add:

```ts
  const conversationInterpreter = buildConversationInterpreter(readAIConfig(env));
```

Pass it into `OnboardingTestModeService`:

```ts
            interpreter: conversationInterpreter
```

- [ ] **Step 6: Add production runtime regression test**

In `tests/production-app-runtime.test.ts`, add or extend an existing route construction test to assert that production runtime can start with OpenAI mode when the API key is configured:

```ts
  it("starts production app with OpenAI interpreter configured for admin test mode", async () => {
    const runtime = await createProductionAppRuntime({
      ...productionEnv(),
      ENABLE_ADMIN_ROUTES: "true",
      AI_INTERPRETER_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-5-mini"
    });

    const response = await runtime.app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_unconfigured_for_route/test-message",
      headers: { authorization: "Bearer admin-secret" },
      payload: { text: "Hola" }
    });

    expect(response.statusCode).toBe(404);
    await runtime.close();
  });
```

Use the existing env helper names in that file. Do not introduce real network calls; the request targets an unconfigured clinic and only proves route/runtime wiring.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/conversation-interpreter-fallback.test.ts tests/production-app-runtime.test.ts tests/onboarding-test-mode.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/application/conversations/fallback-interpreter.ts src/runtime/server-runtime.ts src/runtime/production-app.ts tests/conversation-interpreter-fallback.test.ts tests/production-app-runtime.test.ts
git commit -m "feat: use openai interpreter in onboarding test mode"
```

## Task 3: Browser Test Session Identity

**Files:**
- Create: `apps/web/src/lib/test-mode-session.ts`
- Test: `tests/web-test-mode-session.test.ts`

- [ ] **Step 1: Write failing test for safe identity creation**

Create `tests/web-test-mode-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestModeSession } from "../apps/web/src/lib/test-mode-session.js";

describe("createTestModeSession", () => {
  it("creates backend-safe identifiers for a clinic", () => {
    const session = createTestModeSession("clinic_1", {
      runId: "11111111-1111-4111-8111-111111111111",
      phoneSuffix: "1234567890"
    });

    expect(session).toEqual({
      conversationId: "test:clinic_1:11111111-1111-4111-8111-111111111111",
      patientId: "test_patient:clinic_1:11111111-1111-4111-8111-111111111111",
      whatsappNumber: "+5490001234567890"
    });
  });

  it("rotates identifiers for a new conversation", () => {
    const first = createTestModeSession("clinic_1", {
      runId: "11111111-1111-4111-8111-111111111111",
      phoneSuffix: "1234567890"
    });
    const second = createTestModeSession("clinic_1", {
      runId: "22222222-2222-4222-8222-222222222222",
      phoneSuffix: "9876543210"
    });

    expect(second.conversationId).not.toBe(first.conversationId);
    expect(second.patientId).not.toBe(first.patientId);
    expect(second.whatsappNumber).not.toBe(first.whatsappNumber);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/web-test-mode-session.test.ts
```

Expected: FAIL because `apps/web/src/lib/test-mode-session.ts` does not exist.

- [ ] **Step 3: Implement session helper**

Create `apps/web/src/lib/test-mode-session.ts`:

```ts
export type TestModeSession = {
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
};

type TestModeSessionOverrides = {
  runId?: string;
  phoneSuffix?: string;
};

export function createTestModeSession(
  clinicId: string,
  overrides: TestModeSessionOverrides = {}
): TestModeSession {
  const runId = overrides.runId ?? globalThis.crypto.randomUUID();
  const phoneSuffix = overrides.phoneSuffix ?? `${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;

  return {
    conversationId: `test:${clinicId}:${runId}`,
    patientId: `test_patient:${clinicId}:${runId}`,
    whatsappNumber: `+549000${phoneSuffix.replace(/\D/g, "")}`
  };
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
npm test -- tests/web-test-mode-session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/lib/test-mode-session.ts tests/web-test-mode-session.test.ts
git commit -m "feat: create reusable test mode sessions"
```

## Task 4: Conversational Test Mode UI

**Files:**
- Modify: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write source-level UI regression test**

Because this project does not use a React component test runner, add checks to `tests/web-test-mode-session.test.ts`:

```ts
import { readFileSync } from "node:fs";

const testModePage = readFileSync(
  new URL("../apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx", import.meta.url),
  "utf8"
);
const globals = readFileSync(new URL("../apps/web/src/app/globals.css", import.meta.url), "utf8");
```

Add:

```ts
describe("test mode chat page source", () => {
  it("sends stable test session identifiers with every message", () => {
    expect(testModePage).toMatch(/createTestModeSession/);
    expect(testModePage).toMatch(/conversationId: session\\.conversationId/);
    expect(testModePage).toMatch(/patientId: session\\.patientId/);
    expect(testModePage).toMatch(/whatsappNumber: session\\.whatsappNumber/);
  });

  it("exposes a chat transcript and new conversation action", () => {
    expect(testModePage).toMatch(/New conversation/);
    expect(testModePage).toMatch(/test-chat-thread/);
    expect(testModePage).toMatch(/Dry-run: reads calendar availability but does not create events\\./);
    expect(globals).toMatch(/\\.test-chat-thread/);
    expect(globals).toMatch(/\\.test-chat-message/);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/web-test-mode-session.test.ts
```

Expected: FAIL because the current page does not import `createTestModeSession`, send stable identifiers, or render chat classes.

- [ ] **Step 3: Replace one-message form with chat console**

In `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`, import the helper:

```ts
import { createTestModeSession, type TestModeSession } from "../../../../../../lib/test-mode-session";
```

Use this state shape:

```ts
type ChatMessage = {
  id: string;
  role: "patient" | "momentum";
  text: string;
};
```

Initialize session and chat state:

```ts
  const [session, setSession] = useState<TestModeSession>(() => createTestModeSession(clinicId));
  const [message, setMessage] = useState(defaultMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadPaused, setThreadPaused] = useState(false);
```

Change submit handler to append transcript messages and include stable identifiers:

```ts
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || threadPaused) {
      return;
    }

    const patientMessage: ChatMessage = { id: `${Date.now()}:patient`, role: "patient", text };
    setMessages((current) => [...current, patientMessage]);
    setMessage("");
    setIsRunning(true);
    setStatus("Sending test message...");

    try {
      const result = await apiJson<TestMessageResponse>(`/internal/onboarding/clinics/${clinicId}/test-message`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({
          text,
          conversationId: session.conversationId,
          patientId: session.patientId,
          whatsappNumber: session.whatsappNumber
        })
      });
      setResponse(result);
      setMessages((current) => [
        ...current,
        { id: `${Date.now()}:momentum`, role: "momentum", text: result.result.text }
      ]);
      setThreadPaused(result.result.kind === "handoff");
      setStatus(isPassingResult(result) ? "Test passed." : "Message processed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to run test message.");
    } finally {
      setIsRunning(false);
    }
  }
```

Add reset handler:

```ts
  function startNewConversation() {
    setSession(createTestModeSession(clinicId));
    setMessages([]);
    setResponse(null);
    setThreadPaused(false);
    setMessage(defaultMessage);
    setStatus("New dry-run conversation ready.");
  }
```

Render a `New conversation` button, dry-run note, transcript, composer, and response JSON panel. Keep the admin token field.

- [ ] **Step 4: Add internal chat styles**

Append styles to `apps/web/src/app/globals.css` near the existing internal page styles:

```css
.test-chat-shell {
  display: grid;
  gap: 18px;
}

.test-chat-meta {
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.test-chat-thread {
  display: flex;
  min-height: 340px;
  max-height: 520px;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--line);
  background: #f8faf9;
}

.test-chat-message {
  max-width: min(78%, 560px);
  border: 1px solid var(--line);
  padding: 12px 14px;
  background: #ffffff;
  color: var(--ink);
  font-size: 0.95rem;
  line-height: 1.5;
}

.test-chat-message.patient {
  align-self: flex-end;
  border-color: #1f8f6a;
  background: #e8f8f1;
}

.test-chat-message.momentum {
  align-self: flex-start;
}

.test-chat-role {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.test-chat-composer {
  display: grid;
  gap: 12px;
}

.test-chat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
npm test -- tests/web-test-mode-session.test.ts
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx apps/web/src/app/globals.css tests/web-test-mode-session.test.ts
git commit -m "feat: make onboarding test mode conversational"
```

## Task 5: Final Verification and Deployment

**Files:**
- No planned source changes. Verification only unless a previous task reveals a defect.

- [ ] **Step 1: Run full focused backend/web checks**

Run:

```bash
npm test -- tests/onboarding-test-mode.test.ts tests/conversation-interpreter-fallback.test.ts tests/openai-conversation-interpreter.test.ts tests/web-test-mode-session.test.ts tests/production-app-runtime.test.ts
npm run typecheck
npm run typecheck:web
npm run build:web
git diff --check
```

Expected:

- Vitest reports all selected tests passing.
- Root typecheck exits 0.
- Web typecheck exits 0.
- Web build exits 0.
- `git diff --check` exits 0.

- [ ] **Step 2: Run a local API smoke test**

If no API server is already running in this worktree, run:

```bash
npm run dev:api
```

In a second command, post two messages with the same explicit test identity:

```bash
node --input-type=module <<'NODE'
const baseUrl = "http://127.0.0.1:3000";
const headers = { "content-type": "application/json", authorization: "Bearer admin-secret" };
const payload = {
  conversationId: "test:clinic_1:local-plan-smoke",
  patientId: "test_patient:clinic_1:local-plan-smoke",
  whatsappNumber: "+5490007777777"
};
for (const text of ["Hola", "Quiero reservar botox"]) {
  const response = await fetch(`${baseUrl}/internal/onboarding/clinics/clinic_1/test-message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, text })
  });
  console.log(response.status, await response.text());
}
NODE
```

Expected: both requests reach the app without `P2002`; exact body can depend on local seed state.

- [ ] **Step 3: Deploy production projects**

After commits are pushed to GitHub:

```bash
git push origin codex/conversational-test-mode
```

If deploying directly from CLI is needed:

```bash
npx vercel@latest --prod --scope joaquinemilianodelvecchio-9141s-projects
```

Use the existing project links and aliases. Do not print secrets.

- [ ] **Step 4: Production smoke test**

Run the existing production smoke through the web proxy after API/web deployments are ready:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
function readEnvFile(path) {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    let value = trimmed.slice(i + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, i)] = value;
  }
  return env;
}
const token = readEnvFile(".env").MOMENTUM_ADMIN_TOKEN;
const session = {
  conversationId: `test:clinic_1:prod-smoke-${Date.now()}`,
  patientId: `test_patient:clinic_1:prod-smoke-${Date.now()}`,
  whatsappNumber: `+549000${Date.now()}`
};
for (const text of ["Hola", "Quiero reservar botox."]) {
  const response = await fetch("https://momentum-agent-web.vercel.app/api/backend/internal/onboarding/clinics/clinic_1/test-message", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...session, text })
  });
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  console.log(JSON.stringify({ status: response.status, body }, null, 2));
}
NODE
```

Expected: both responses return 200. The second response should still use real Google Calendar availability for booking.

- [ ] **Step 5: Final commit status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: clean working tree on `codex/conversational-test-mode` with task commits present.

## Self-Review Checklist

- Spec coverage: backend interpreter injection, OpenAI fallback, chat UI, stable test identity, New conversation, dry-run preservation, and production smoke are all covered.
- Completeness scan: no incomplete markers or vague fill-in instructions are present.
- Type consistency: `ConversationInterpreter`, `ConversationUnderstanding`, `TestModeSession`, `conversationId`, `patientId`, and `whatsappNumber` names match existing code and planned new files.
