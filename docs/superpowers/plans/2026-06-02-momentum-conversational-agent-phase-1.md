# Momentum Conversational Agent Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first inbound correctness slice of the Momentum Conversational Agent so pending bookings survive smalltalk/questions, configured services are answered from clinic context, pending slot refinements work, and Test Mode confirms dry-runs without creating calendar events.

**Architecture:** Keep the current `ConversationWorkflow` boundary, but add a small deterministic decision layer before side-effect actions. Extend structured understanding only enough for Phase 1, then route through application-owned guards and preconditions rather than trusting the model to execute actions.

**Tech Stack:** TypeScript, Vitest, Zod, Fastify test injection, existing in-memory repositories, existing fake calendar.

---

## Scope

This plan implements the first child block from `docs/superpowers/specs/2026-06-02-momentum-conversational-agent-design.md`: evaluation harness and inbound brain v1.

This plan does not implement WhatsApp Flow sending, outbound reminders, reactivation intelligence, or a full transcript trace panel. Those remain in the umbrella spec for later child plans.

## File Structure

- Create: `tests/momentum-conversational-agent-phase-1.test.ts`
  - Transcript-style red tests for the reproduced Test Mode behavior and pending-booking protection.
- Create: `tests/conversation-agent-decisions.test.ts`
  - Unit tests for deterministic non-transactional reply detection.
- Create: `src/application/conversations/agent-decisions.ts`
  - Small, deterministic helpers for smalltalk, service catalog, and pending slot refinement classification.
- Modify: `src/application/conversations/interpreter.ts`
  - Add Phase 1 intent values.
- Modify: `src/application/conversations/rules-interpreter.ts`
  - Return Phase 1 structured intents for obvious local cases.
- Modify: `src/adapters/openai/openai-conversation-interpreter.ts`
  - Update instructions and payload for Phase 1 intents and richer pending booking context.
- Modify: `src/application/conversations/conversation-workflow.ts`
  - Store clinic profile once, run non-transactional guards before side effects, handle pending slot refinement, and support dry-run booking mode.
- Modify: `src/application/onboarding/test-mode-service.ts`
  - Construct `ConversationWorkflow` in dry-run booking mode and mark dry-run confirmation as a passing test.
- Modify: `tests/onboarding-test-mode.test.ts`
  - Replace the old dry-run false-unavailable expectation with the new simulated-confirmation expectation.

---

### Task 1: Add Red Transcript Tests For Phase 1

**Files:**
- Create: `tests/momentum-conversational-agent-phase-1.test.ts`
- Test: `tests/momentum-conversational-agent-phase-1.test.ts`

- [ ] **Step 1: Write the failing transcript tests**

Create `tests/momentum-conversational-agent-phase-1.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "../src/application/conversations/interpreter.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

function buildContext(interpreter: ConversationInterpreter) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();
  const now = () => new Date("2026-06-01T12:00:00.000Z");

  repos.upsertClinicProfile(
    parseClinicProfile({
      clinicId: "clinic_1",
      name: "Clinica Demo",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "Evitar alcohol 24 horas antes.",
          restrictions: [],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  const scheduling = new SchedulingService(repos, calendar, audit, now);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, now, interpreter);
  return { repos, calendar, workflow };
}

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "question",
    confidence: 0.95,
    requestedTopics: [],
    requiresHuman: false,
    reason: "fake",
    ...input
  };
}

class SequenceInterpreter implements ConversationInterpreter {
  readonly inputs: ConversationInterpreterInput[] = [];

  constructor(private readonly results: ConversationUnderstanding[]) {}

  async interpret(input: ConversationInterpreterInput) {
    this.inputs.push(input);
    const next = this.results.shift();
    if (!next) {
      throw new Error(`No fake understanding configured for ${input.messageText}`);
    }
    return next;
  }
}

describe("Momentum Conversational Agent Phase 1", () => {
  it("answers smalltalk during a pending offer without confirming or losing the slot", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({ intent: "confirm", confidence: 0.99 })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T12:00:00.000Z"), endsAt: new Date("2026-06-02T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });
    const pending = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "como te llamas"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Momentum");
    expect(result.text).toContain("turnos");
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      pending
    );
  });

  it("answers the configured service catalog during a pending offer without losing the slot", async () => {
    const interpreter = new SequenceInterpreter([
      understanding({ intent: "book", serviceName: "Botox" }),
      understanding({ intent: "unknown", confidence: 0.2 })
    ]);
    const { calendar, repos, workflow } = buildContext(interpreter);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-02T12:00:00.000Z"), endsAt: new Date("2026-06-02T12:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, quiero reservar botox."
    });
    const pending = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "que servicios ofrecen"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Por ahora puedo ayudarte con: Botox."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      pending
    );
  });
});
```

- [ ] **Step 2: Run the red tests**

Run:

```bash
npx vitest run tests/momentum-conversational-agent-phase-1.test.ts
```

Expected: FAIL. The first test returns either the confirmation/data-collection branch or the generic helper response instead of a Momentum role answer. The second test returns the generic helper response instead of `Por ahora puedo ayudarte con: Botox.`

- [ ] **Step 3: Commit the red tests**

Run:

```bash
git add tests/momentum-conversational-agent-phase-1.test.ts
git commit -m "test: add momentum agent phase one regressions"
```

Expected: Commit succeeds with only `tests/momentum-conversational-agent-phase-1.test.ts`.

---

### Task 2: Add Deterministic Non-Transactional Decision Helpers

**Files:**
- Create: `tests/conversation-agent-decisions.test.ts`
- Create: `src/application/conversations/agent-decisions.ts`

- [ ] **Step 1: Write helper unit tests**

Create `tests/conversation-agent-decisions.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildNonTransactionalReply } from "../src/application/conversations/agent-decisions.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

const profile = parseClinicProfile({
  clinicId: "clinic_1",
  name: "Clinica Demo",
  timezone: "America/Argentina/Buenos_Aires",
  services: [
    {
      id: "svc_botox",
      name: "Botox",
      durationMinutes: 30,
      priceText: "Desde $120.000",
      preparation: "Evitar alcohol 24 horas antes.",
      restrictions: [],
      professionalIds: ["pro_perez"]
    }
  ],
  professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
  appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
  requiredPatientFields: ["fullName"]
});

describe("agent decision helpers", () => {
  it("answers role smalltalk without a transactional action", () => {
    expect(buildNonTransactionalReply({ messageText: "como te llamas", clinicProfile: profile })).toEqual({
      kind: "reply",
      text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
    });
  });

  it("answers service catalog questions from the configured clinic profile", () => {
    expect(buildNonTransactionalReply({ messageText: "que servicios ofrecen", clinicProfile: profile })).toEqual({
      kind: "reply",
      text: "Por ahora puedo ayudarte con: Botox."
    });
  });

  it("does not intercept transactional booking text", () => {
    expect(buildNonTransactionalReply({ messageText: "quiero reservar botox", clinicProfile: profile })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the helper tests red**

Run:

```bash
npx vitest run tests/conversation-agent-decisions.test.ts
```

Expected: FAIL with `Cannot find module '../src/application/conversations/agent-decisions.js'`.

- [ ] **Step 3: Create the helper implementation**

Create `src/application/conversations/agent-decisions.ts` with:

```ts
import type { ClinicProfile } from "../../domain/types.js";
import { normalizeText } from "./intent.js";
import { formatServiceList } from "./service-matching.js";

export type AgentReplyDecision = {
  kind: "reply";
  text: string;
};

export function buildNonTransactionalReply(input: {
  messageText: string;
  clinicProfile?: ClinicProfile;
}): AgentReplyDecision | undefined {
  const normalized = normalizeText(input.messageText);

  if (isRoleSmalltalk(normalized)) {
    return {
      kind: "reply",
      text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
    };
  }

  if (isServiceCatalogQuestion(normalized)) {
    return {
      kind: "reply",
      text: input.clinicProfile
        ? `Por ahora puedo ayudarte con: ${formatServiceList(input.clinicProfile)}.`
        : "Todavia no tengo los servicios configurados para esta clinica."
    };
  }

  return undefined;
}

function isRoleSmalltalk(normalized: string) {
  return (
    normalized.includes("como te llamas") ||
    normalized.includes("quien sos") ||
    normalized.includes("quien eres") ||
    normalized.includes("sos un bot") ||
    normalized.includes("eres un bot")
  );
}

function isServiceCatalogQuestion(normalized: string) {
  return (
    normalized.includes("que servicios ofrecen") ||
    normalized.includes("servicios ofrecen") ||
    normalized.includes("que tratamientos tienen") ||
    normalized.includes("tratamientos ofrecen") ||
    normalized.includes("que hacen")
  );
}
```

- [ ] **Step 4: Run the helper tests green**

Run:

```bash
npx vitest run tests/conversation-agent-decisions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper tests and implementation**

Run:

```bash
git add tests/conversation-agent-decisions.test.ts src/application/conversations/agent-decisions.ts
git commit -m "feat: add non transactional agent decisions"
```

Expected: Commit succeeds with the helper test and helper implementation.

---

### Task 3: Wire Non-Transactional Guards Into The Workflow

**Files:**
- Modify: `src/application/conversations/conversation-workflow.ts`
- Test: `tests/momentum-conversational-agent-phase-1.test.ts`
- Test: `tests/conversation-workflow.test.ts`
- Test: `tests/conversation-workflow-ai.test.ts`

- [ ] **Step 1: Import the helper and store clinic profile once**

In `src/application/conversations/conversation-workflow.ts`, add:

```ts
import { buildNonTransactionalReply } from "./agent-decisions.js";
```

Inside `handleInboundMessageLocked`, replace the inline profile lookup with a local variable:

```ts
const clinicProfile = await this.repos.getClinicProfile(input.clinicId);
const intent = await this.interpreter.interpret({
  clinicId: input.clinicId,
  conversationId: input.conversationId,
  patientId: input.patientId,
  messageText: input.text,
  now: this.now(),
  clinicProfile,
  pendingBooking: conversation.pendingBooking
});
```

- [ ] **Step 2: Add the guard before side-effect actions**

After the audit record and before the `requiresHuman` check, insert:

```ts
const nonTransactionalReply = buildNonTransactionalReply({
  messageText: input.text,
  clinicProfile
});
if (nonTransactionalReply) {
  return nonTransactionalReply;
}
```

- [ ] **Step 3: Run the Phase 1 tests**

Run:

```bash
npx vitest run tests/momentum-conversational-agent-phase-1.test.ts tests/conversation-agent-decisions.test.ts
```

Expected: PASS for the two Phase 1 transcript tests and helper tests.

- [ ] **Step 4: Run conversation regression tests**

Run:

```bash
npx vitest run tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit workflow guard**

Run:

```bash
git add src/application/conversations/conversation-workflow.ts
git commit -m "fix: protect pending offers from non transactional chat"
```

Expected: Commit succeeds with only `src/application/conversations/conversation-workflow.ts`.

---

### Task 4: Extend Structured Understanding For Phase 1 Intents

**Files:**
- Modify: `src/application/conversations/interpreter.ts`
- Modify: `src/application/conversations/rules-interpreter.ts`
- Modify: `src/adapters/openai/openai-conversation-interpreter.ts`
- Test: `tests/conversation-interpreter.test.ts`
- Test: `tests/openai-conversation-interpreter.test.ts`

- [ ] **Step 1: Add interpreter tests for new rule intents**

In `tests/conversation-interpreter.test.ts`, add:

```ts
it("detects obvious smalltalk and service catalog questions", async () => {
  const interpreter = new RulesConversationInterpreter();

  await expect(
    interpreter.interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "como te llamas",
      now: new Date("2026-06-01T12:00:00.000Z")
    })
  ).resolves.toEqual(
    expect.objectContaining({
      provider: "rules",
      intent: "smalltalk",
      confidence: 0.9
    })
  );

  await expect(
    interpreter.interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "que servicios ofrecen",
      now: new Date("2026-06-01T12:00:00.000Z")
    })
  ).resolves.toEqual(
    expect.objectContaining({
      provider: "rules",
      intent: "services_catalog",
      confidence: 0.9
    })
  );
});
```

- [ ] **Step 2: Run the interpreter test red**

Run:

```bash
npx vitest run tests/conversation-interpreter.test.ts
```

Expected: FAIL because `smalltalk` and `services_catalog` are not valid intent values.

- [ ] **Step 3: Extend the schema**

In `src/application/conversations/interpreter.ts`, replace the intent enum with:

```ts
intent: z.enum([
  "book",
  "confirm",
  "reschedule",
  "cancel",
  "question",
  "smalltalk",
  "services_catalog",
  "slot_refinement",
  "handoff",
  "medical_safety",
  "unknown"
]),
```

- [ ] **Step 4: Extend the rule interpreter**

In `src/application/conversations/rules-interpreter.ts`, after `const intent = interpretIntent(input.messageText);`, insert:

```ts
const normalized = normalizeText(input.messageText);
if (
  normalized.includes("como te llamas") ||
  normalized.includes("quien sos") ||
  normalized.includes("quien eres")
) {
  return {
    provider: "rules",
    intent: "smalltalk",
    confidence: 0.9,
    requestedTopics: [],
    requiresHuman: false,
    reason: "Rule-based role smalltalk matched."
  };
}

if (
  normalized.includes("que servicios ofrecen") ||
  normalized.includes("servicios ofrecen") ||
  normalized.includes("que tratamientos tienen") ||
  normalized.includes("tratamientos ofrecen")
) {
  return {
    provider: "rules",
    intent: "services_catalog",
    confidence: 0.9,
    requestedTopics: [],
    requiresHuman: false,
    reason: "Rule-based service catalog question matched."
  };
}
```

- [ ] **Step 5: Extend OpenAI instructions and pending booking payload**

In `src/adapters/openai/openai-conversation-interpreter.ts`, add these instruction lines inside `buildInstructions()`:

```ts
"Classify role questions like 'como te llamas' or 'quien sos' as smalltalk, not confirm.",
"Classify service catalog questions like 'que servicios ofrecen' as services_catalog.",
"Classify requests to change an offered slot by day, time, or professional as slot_refinement when a pending booking is present.",
```

In `buildInterpreterPayload`, replace the pending booking payload with:

```ts
pendingBooking: input.pendingBooking
  ? {
      hasPendingBooking: true,
      serviceId: input.pendingBooking.serviceId,
      professionalId: input.pendingBooking.professionalId,
      startsAt: input.pendingBooking.startsAt.toISOString(),
      endsAt: input.pendingBooking.endsAt.toISOString()
    }
  : { hasPendingBooking: false },
```

- [ ] **Step 6: Update OpenAI interpreter test**

In `tests/openai-conversation-interpreter.test.ts`, add:

```ts
it("passes pending booking context to OpenAI without calendar identifiers", async () => {
  const client = new FakeOpenAIClient({
    intent: "slot_refinement",
    confidence: 0.91,
    serviceName: null,
    professionalPreference: null,
    timePreference: "a la tarde",
    normalizedTimePreference: { daypart: "afternoon" },
    requestedTopics: [],
    patientFullName: null,
    requiresHuman: false,
    safetyReason: null,
    reason: "Patient asks to refine the pending offered slot."
  });

  const result = await new OpenAIConversationInterpreter({
    client,
    model: "gpt-5-mini",
    timeoutMs: 500
  }).interpret({
    clinicId: "clinic_1",
    conversationId: "conv_1",
    patientId: "pat_1",
    messageText: "tenes algo a la tarde?",
    now: new Date("2026-05-29T12:00:00.000Z"),
    clinicProfile: profile,
    pendingBooking: {
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    }
  });

  expect(result).toEqual(expect.objectContaining({ intent: "slot_refinement" }));
  expect(JSON.stringify(client.lastBody)).toContain("svc_botox");
  expect(JSON.stringify(client.lastBody)).not.toContain("cal_perez");
});
```

- [ ] **Step 7: Run interpreter tests green**

Run:

```bash
npx vitest run tests/conversation-interpreter.test.ts tests/openai-conversation-interpreter.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit structured understanding changes**

Run:

```bash
git add src/application/conversations/interpreter.ts src/application/conversations/rules-interpreter.ts src/adapters/openai/openai-conversation-interpreter.ts tests/conversation-interpreter.test.ts tests/openai-conversation-interpreter.test.ts
git commit -m "feat: extend conversation understanding for phase one"
```

Expected: Commit succeeds with schema, interpreter, adapter, and interpreter tests.

---

### Task 5: Add Pending Slot Refinement

**Files:**
- Modify: `tests/momentum-conversational-agent-phase-1.test.ts`
- Modify: `src/application/conversations/agent-decisions.ts`
- Modify: `src/application/conversations/conversation-workflow.ts`

- [ ] **Step 1: Add a red refinement transcript test**

In `tests/momentum-conversational-agent-phase-1.test.ts`, add:

```ts
it("refines a pending offered slot by time preference without requiring the service again", async () => {
  const interpreter = new SequenceInterpreter([
    understanding({ intent: "book", serviceName: "Botox" }),
    understanding({
      intent: "slot_refinement",
      serviceName: null,
      timePreference: "a la tarde",
      normalizedTimePreference: { daypart: "afternoon" }
    })
  ]);
  const { calendar, repos, workflow } = buildContext(interpreter);
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-02T10:00:00.000Z"), endsAt: new Date("2026-06-02T10:30:00.000Z") },
    { startsAt: new Date("2026-06-02T15:00:00.000Z"), endsAt: new Date("2026-06-02T15:30:00.000Z") }
  ]);

  await workflow.handleInboundMessage({
    clinicId: "clinic_1",
    conversationId: "conv_1",
    patientId: "pat_1",
    whatsappNumber: "+5491111111111",
    text: "Hola, quiero reservar botox."
  });

  const result = await workflow.handleInboundMessage({
    clinicId: "clinic_1",
    conversationId: "conv_1",
    patientId: "pat_1",
    whatsappNumber: "+5491111111111",
    text: "tenes algo a la tarde?"
  });

  expect(result.kind).toBe("reply");
  expect(result.text).toContain("2026-06-02T15:00:00.000Z");
  expect(result.text).not.toContain("Decime que tratamiento");
  expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
    expect.objectContaining({
      startsAt: new Date("2026-06-02T15:00:00.000Z"),
      endsAt: new Date("2026-06-02T15:30:00.000Z")
    })
  );
});
```

- [ ] **Step 2: Run the refinement test red**

Run:

```bash
npx vitest run tests/momentum-conversational-agent-phase-1.test.ts
```

Expected: FAIL because `slot_refinement` is not handled by `ConversationWorkflow`.

- [ ] **Step 3: Add a helper for refinement classification**

In `src/application/conversations/agent-decisions.ts`, add:

```ts
import type { ConversationUnderstanding } from "./interpreter.js";

export function isPendingSlotRefinementIntent(intent: ConversationUnderstanding) {
  return (
    intent.intent === "slot_refinement" ||
    (intent.intent === "book" &&
      !intent.serviceName &&
      Boolean(intent.timePreference || intent.normalizedTimePreference || intent.professionalPreference))
  );
}
```

Keep the existing imports and merge the new type import with the file's current imports.

- [ ] **Step 4: Wire refinement before generic booking handling**

In `src/application/conversations/conversation-workflow.ts`, update the import:

```ts
import { buildNonTransactionalReply, isPendingSlotRefinementIntent } from "./agent-decisions.js";
```

Before the `if (intent.intent === "book")` branch, insert:

```ts
if (conversation.pendingBooking && isPendingSlotRefinementIntent(intent)) {
  return await this.handlePendingSlotRefinement(input, conversation, intent);
}
```

Add this private method inside `ConversationWorkflow` before `handleBookingIntent`:

```ts
private async handlePendingSlotRefinement(
  input: InboundMessage,
  conversation: Conversation,
  intent: ConversationUnderstanding
): Promise<WorkflowResult> {
  const profile = await this.repos.getClinicProfile(input.clinicId);
  const pending = conversation.pendingBooking;
  if (!profile || !pending) {
    return { kind: "reply", text: "Decime que tratamiento queres reservar y te paso horarios disponibles." };
  }

  const service = profile.services.find((candidate) => candidate.id === pending.serviceId);
  if (!service) {
    await this.clearPendingBooking(input.clinicId, input.conversationId);
    return { kind: "reply", text: "No pude encontrar el tratamiento pendiente. Decime cual queres reservar." };
  }

  const preferredProfessional = findProfessional(profile, intent.professionalPreference);
  const searchFrom = startOfDay(this.now());
  const defaultTo = addDays(searchFrom, 14);
  const range = resolveSlotSearchRange({
    defaultFrom: searchFrom,
    defaultTo,
    understanding: intent
  });
  const slots = filterSlotsByDaypart(
    await this.scheduling.findSlots({
      clinicId: input.clinicId,
      serviceId: service.id,
      professionalId: preferredProfessional?.id ?? pending.professionalId,
      from: range.from,
      to: range.to
    }),
    intent,
    profile.timezone
  ).filter((slot) => slot.startsAt.getTime() !== pending.startsAt.getTime());

  if (slots.length === 0) {
    return {
      kind: "reply",
      text: `No encontre otro horario disponible para ${service.name} con esa preferencia. Te puedo mantener el horario ofrecido.`
    };
  }

  const first = slots[0];
  const professional = profile.professionals.find((candidate) => candidate.calendarId === first.calendarId);
  if (!professional) {
    return { kind: "reply", text: `No pude identificar el profesional disponible para ${service.name}.` };
  }

  await this.setPendingBooking(input.clinicId, input.conversationId, {
    serviceId: service.id,
    professionalId: professional.id,
    startsAt: first.startsAt,
    endsAt: first.endsAt
  });

  return {
    kind: "reply",
    text: `Tengo este horario: ${first.startsAt.toISOString()} con disponibilidad para ${service.name}. Si te sirve, lo confirmamos.`
  };
}
```

- [ ] **Step 5: Run refinement and conversation tests green**

Run:

```bash
npx vitest run tests/momentum-conversational-agent-phase-1.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit refinement**

Run:

```bash
git add tests/momentum-conversational-agent-phase-1.test.ts src/application/conversations/agent-decisions.ts src/application/conversations/conversation-workflow.ts
git commit -m "feat: refine pending offered slots"
```

Expected: Commit succeeds with refinement tests and implementation.

---

### Task 6: Fix Test Mode Dry-Run Confirmation

**Files:**
- Modify: `src/application/conversations/conversation-workflow.ts`
- Modify: `src/application/onboarding/test-mode-service.ts`
- Modify: `tests/onboarding-test-mode.test.ts`

- [ ] **Step 1: Replace the old dry-run expectation**

In `tests/onboarding-test-mode.test.ts`, in the test named `dry-runs confirmation paths without saving appointments or calendar events`, replace the result expectation with:

```ts
expect(result).toEqual({
  kind: "reply",
  text: "Dry-run: el turno se podria confirmar para 2026-06-01T13:00:00.000Z. No se creo ningun evento real."
});
```

Replace the readiness expectation in that same test with:

```ts
await expect(context.onboarding.getClinicSetup("clinic_setup")).resolves.toEqual(
  expect.objectContaining({ testConversationPassed: true })
);
```

- [ ] **Step 2: Run the dry-run test red**

Run:

```bash
npx vitest run tests/onboarding-test-mode.test.ts
```

Expected: FAIL because Test Mode still returns `Ese horario ya no esta disponible. Te busco otro horario si queres.`

- [ ] **Step 3: Add workflow booking mode**

In `src/application/conversations/conversation-workflow.ts`, add near the constructor types:

```ts
export type ConversationWorkflowOptions = {
  bookingMode?: "execute" | "dry-run";
};
```

Update the constructor signature to:

```ts
constructor(
  private readonly repos: OperationalRepository,
  private readonly scheduling: SchedulingService,
  private readonly audit: AuditLogPort,
  private readonly now: () => Date = () => new Date(),
  private readonly interpreter: ConversationInterpreter = new RulesConversationInterpreter(),
  private readonly options: ConversationWorkflowOptions = {}
) {}
```

- [ ] **Step 4: Simulate confirmation in dry-run mode**

In `handleConfirmation`, after the required-patient-fields block and before the `try` that calls `this.scheduling`, insert:

```ts
if (this.options.bookingMode === "dry-run") {
  await this.clearPendingBooking(input.clinicId, input.conversationId);
  return {
    kind: "reply",
    text: `Dry-run: el turno se podria confirmar para ${pending.startsAt.toISOString()}. No se creo ningun evento real.`
  };
}
```

- [ ] **Step 5: Use dry-run mode in Test Mode**

In `src/application/onboarding/test-mode-service.ts`, update the `ConversationWorkflow` construction to pass dry-run options:

```ts
this.workflow = new ConversationWorkflow(
  options.operational,
  scheduling,
  options.audit,
  this.now,
  options.interpreter ?? new RulesConversationInterpreter(),
  { bookingMode: "dry-run" }
);
```

Update `isPositiveBookingTestReply` to:

```ts
function isPositiveBookingTestReply(result: WorkflowResult): boolean {
  return (
    result.kind === "reply" &&
    (result.text.includes("Tengo este horario") || result.text.includes("Dry-run: el turno se podria confirmar"))
  );
}
```

- [ ] **Step 6: Run Test Mode and workflow tests green**

Run:

```bash
npx vitest run tests/onboarding-test-mode.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit dry-run confirmation**

Run:

```bash
git add src/application/conversations/conversation-workflow.ts src/application/onboarding/test-mode-service.ts tests/onboarding-test-mode.test.ts
git commit -m "fix: simulate test mode booking confirmation"
```

Expected: Commit succeeds with dry-run mode implementation and updated test.

---

### Task 7: Add Minimal Agent Trace Shape

**Files:**
- Create: `tests/conversation-agent-trace.test.ts`
- Create: `src/application/conversations/agent-trace.ts`

- [ ] **Step 1: Write trace shape tests**

Create `tests/conversation-agent-trace.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildAgentTrace } from "../src/application/conversations/agent-trace.js";

describe("agent trace", () => {
  it("captures state, understanding, decision, and tool result in one stable object", () => {
    const trace = buildAgentTrace({
      state: {
        stage: "offering_slot",
        hasPendingBooking: true,
        botPaused: false
      },
      understanding: {
        provider: "openai",
        intent: "services_catalog",
        confidence: 0.95
      },
      decision: {
        action: "show_services",
        reason: "Patient asked for configured service catalog."
      },
      tool: {
        name: "clinic_profile",
        result: "read"
      }
    });

    expect(trace.state.stage).toBe("offering_slot");
    expect(trace.understanding.intent).toBe("services_catalog");
    expect(trace.decision.action).toBe("show_services");
    expect(trace.tool?.name).toBe("clinic_profile");
  });
});
```

- [ ] **Step 2: Run trace test red**

Run:

```bash
npx vitest run tests/conversation-agent-trace.test.ts
```

Expected: FAIL with `Cannot find module '../src/application/conversations/agent-trace.js'`.

- [ ] **Step 3: Create trace shape implementation**

Create `src/application/conversations/agent-trace.ts` with:

```ts
export type AgentStage =
  | "idle"
  | "selecting_service"
  | "offering_slot"
  | "collecting_patient_data"
  | "booking_ready"
  | "booked"
  | "rescheduling"
  | "cancelling"
  | "handoff"
  | "paused";

export type AgentAction =
  | "reply"
  | "answer_faq"
  | "show_services"
  | "search_slots"
  | "offer_slot"
  | "refine_slot"
  | "collect_patient_data"
  | "start_whatsapp_flow"
  | "book_appointment"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "send_reminder"
  | "handoff"
  | "pause"
  | "no_op_wait";

export type AgentTrace = {
  state: {
    stage: AgentStage;
    hasPendingBooking: boolean;
    botPaused: boolean;
  };
  understanding: {
    provider: string;
    intent: string;
    confidence: number;
  };
  decision: {
    action: AgentAction;
    reason: string;
  };
  tool?: {
    name: string;
    result: "read" | "simulated" | "executed" | "skipped" | "failed";
  };
};

export function buildAgentTrace(trace: AgentTrace): AgentTrace {
  return trace;
}
```

- [ ] **Step 4: Run trace test green**

Run:

```bash
npx vitest run tests/conversation-agent-trace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit trace shape**

Run:

```bash
git add tests/conversation-agent-trace.test.ts src/application/conversations/agent-trace.ts
git commit -m "feat: add agent trace shape"
```

Expected: Commit succeeds with the trace shape files.

---

### Task 8: Final Verification

**Files:**
- Verify all files changed in Tasks 1-7.

- [ ] **Step 1: Run targeted agent tests**

Run:

```bash
npx vitest run tests/momentum-conversational-agent-phase-1.test.ts tests/conversation-agent-decisions.test.ts tests/conversation-agent-trace.test.ts tests/conversation-interpreter.test.ts tests/openai-conversation-interpreter.test.ts tests/onboarding-test-mode.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-ai.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff --stat HEAD
```

Expected: Only these paths appear:

```text
src/adapters/openai/openai-conversation-interpreter.ts
src/application/conversations/agent-decisions.ts
src/application/conversations/agent-trace.ts
src/application/conversations/conversation-workflow.ts
src/application/conversations/interpreter.ts
src/application/conversations/rules-interpreter.ts
src/application/onboarding/test-mode-service.ts
tests/conversation-agent-decisions.test.ts
tests/conversation-agent-trace.test.ts
tests/conversation-interpreter.test.ts
tests/momentum-conversational-agent-phase-1.test.ts
tests/onboarding-test-mode.test.ts
tests/openai-conversation-interpreter.test.ts
```

- [ ] **Step 4: Commit any remaining verified changes**

Run:

```bash
git status --short
git add src/adapters/openai/openai-conversation-interpreter.ts src/application/conversations/agent-decisions.ts src/application/conversations/agent-trace.ts src/application/conversations/conversation-workflow.ts src/application/conversations/interpreter.ts src/application/conversations/rules-interpreter.ts src/application/onboarding/test-mode-service.ts tests/conversation-agent-decisions.test.ts tests/conversation-agent-trace.test.ts tests/conversation-interpreter.test.ts tests/momentum-conversational-agent-phase-1.test.ts tests/onboarding-test-mode.test.ts tests/openai-conversation-interpreter.test.ts
git commit -m "feat: implement momentum conversational agent phase one"
```

Expected: If every previous task was committed, Git reports nothing to commit. If a task left verified changes uncommitted, this creates one final scoped commit.

## Self-Review

- Spec coverage: This plan covers the first child block from the umbrella spec: transcript-level regressions, state-preserving inbound behavior, richer structured understanding, a first action/trace shape, pending slot refinement, and Test Mode dry-run correctness.
- Out of scope for this plan: WhatsApp Flow execution, outbound reminder intelligence, no-show follow-up, reactivation, freed-slot outbound, and full trace panel UI.
- Placeholder scan: The plan contains exact file paths, commands, expected results, and code snippets for each code step.
- Type consistency: New intent values are `smalltalk`, `services_catalog`, and `slot_refinement`; new decision helper exports are `buildNonTransactionalReply` and `isPendingSlotRefinementIntent`; workflow dry-run option is `bookingMode: "dry-run"`.
