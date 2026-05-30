# Prisma Operational Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Momentum's real WhatsApp/Kapso operational state in Prisma so booking state, handoff pause, opt-out, appointments, audit, and webhook idempotency survive process restarts.

**Architecture:** Introduce a provider-neutral operational repository port that can be implemented by the existing in-memory repository or by Prisma. Keep simulation routes on memory, but wire the real Kapso runtime to Prisma repositories and Prisma audit logging. Clinic profile remains seed/config-driven; `upsertClinicProfile()` syncs the seed enough to satisfy Prisma relations while `getClinicProfile()` returns the full in-process profile including working hours.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Prisma, SQLite local tests, Vitest, existing Google Calendar and Kapso adapters.

---

## Scope Check

This plan implements the persistence block only:
- operational repository port;
- Prisma operational repository;
- Prisma audit log;
- processed webhook delivery table;
- runtime wiring for real Kapso;
- tests proving restart durability and duplicate webhook protection.

It does not implement dashboard, onboarding UI, user roles, analytics, schedulers, OpenAI intent interpretation, Outlook, or editable clinic configuration.

## File Structure

- `src/ports/repositories.ts`: shared repository contract, entity types currently owned by `InMemoryRepositories`, and `MaybePromise`.
- `src/adapters/memory/repositories.ts`: implements `OperationalRepository` while preserving its current synchronous behavior for local tests.
- `src/adapters/prisma/operational-repository.ts`: Prisma implementation for patients, conversations, appointments, patient interests, opt-out, seeded clinic rows, and processed webhook deliveries.
- `src/adapters/prisma/audit-log.ts`: Prisma implementation of `AuditLogPort`.
- `src/dev/demo-clinic-profile.ts`: reusable demo clinic seed used by in-memory and Prisma runtime setup.
- `src/dev/seed.ts`: uses `buildDemoClinicProfile()` and remains the simulation container.
- `src/server.ts`: creates shared Prisma runtime when Google Calendar or Kapso persistence needs Prisma; wires Kapso to `PrismaOperationalRepository` and `PrismaAuditLog`.
- `prisma/schema.prisma`: adds `ProcessedWebhookDelivery`.
- `prisma/migrations/<timestamp>_add_processed_webhook_deliveries/migration.sql`: migration for the new table.
- `tests/helpers/prisma.ts`: temporary SQLite DB + migration helper reused across Prisma tests.
- `tests/google-oauth.test.ts`: imports the shared Prisma test helper instead of duplicating migration logic.
- `tests/prisma-operational-repository.test.ts`: Prisma repository and audit persistence tests.
- `tests/prisma-runtime-persistence.test.ts`: restart-flow and duplicate-webhook integration tests.
- `tests/conversation-workflow.test.ts`, `tests/scheduling-service.test.ts`, `tests/kapso-webhook.test.ts`, `tests/whatsapp-provider.test.ts`: small async-await updates where repository calls become awaited through services.
- `README.md`: documents that real Kapso runtime stores operational state in Prisma.

## Task 1: Introduce Operational Repository Port

**Files:**
- Create: `src/ports/repositories.ts`
- Modify: `src/adapters/memory/repositories.ts`
- Modify: `src/application/conversations/conversation-workflow.ts`
- Modify: `src/application/scheduling/scheduling-service.ts`
- Modify: `src/application/messaging/whatsapp-inbound-service.ts`
- Modify: `src/application/messaging/outbound-template-service.ts`
- Test: `tests/repository-port.test.ts`

- [ ] **Step 1: Write the failing port compatibility test**

Create `tests/repository-port.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { OperationalRepository } from "../src/ports/repositories.js";

describe("OperationalRepository port", () => {
  it("allows workflow services to use an async repository implementation", async () => {
    const base = new InMemoryRepositories();
    const repos: OperationalRepository = new AsyncRepositoryAdapter(base);
    const audit = new InMemoryAuditLog();
    const calendar = new FakeCalendar();

    await repos.upsertClinicProfile(
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
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
    const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date("2026-05-29T12:00:00.000Z"));

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_async",
      patientId: "pat_async",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(result.kind).toBe("reply");
    expect((await repos.getConversation("conv_async"))?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
  });
});

class AsyncRepositoryAdapter implements OperationalRepository {
  constructor(private readonly inner: InMemoryRepositories) {}
  async upsertClinicProfile(input: Parameters<InMemoryRepositories["upsertClinicProfile"]>[0]) {
    return this.inner.upsertClinicProfile(input);
  }
  async getClinicProfile(input: string) {
    return this.inner.getClinicProfile(input);
  }
  async upsertPatient(input: Parameters<InMemoryRepositories["upsertPatient"]>[0]) {
    return this.inner.upsertPatient(input);
  }
  async getPatient(input: string) {
    return this.inner.getPatient(input);
  }
  async saveConversation(input: Parameters<InMemoryRepositories["saveConversation"]>[0]) {
    return this.inner.saveConversation(input);
  }
  async getConversation(input: string) {
    return this.inner.getConversation(input);
  }
  async saveAppointment(input: Parameters<InMemoryRepositories["saveAppointment"]>[0]) {
    return this.inner.saveAppointment(input);
  }
  async nextAppointmentId() {
    return this.inner.nextAppointmentId();
  }
  async withAppointmentLock<T>(appointmentId: string, operation: () => Promise<T>) {
    return this.inner.withAppointmentLock(appointmentId, operation);
  }
  async getAppointment(input: string) {
    return this.inner.getAppointment(input);
  }
  async listAppointmentsByPatient(input: string) {
    return this.inner.listAppointmentsByPatient(input);
  }
  async saveInterest(input: Parameters<InMemoryRepositories["saveInterest"]>[0]) {
    return this.inner.saveInterest(input);
  }
  async listActiveInterests() {
    return this.inner.listActiveInterests();
  }
  async markOptOut(input: string) {
    return this.inner.markOptOut(input);
  }
  async isOptedOut(input: string) {
    return this.inner.isOptedOut(input);
  }
  async hasProcessedWebhookDelivery(input: string) {
    return this.inner.hasProcessedWebhookDelivery(input);
  }
  async markProcessedWebhookDelivery(input: string) {
    return this.inner.markProcessedWebhookDelivery(input);
  }
}
```

Run:

```bash
npm test -- tests/repository-port.test.ts
```

Expected: FAIL because `src/ports/repositories.ts` does not exist and workflow constructors still require `InMemoryRepositories`.

- [ ] **Step 2: Add repository port**

Create `src/ports/repositories.ts`:

```ts
import type { Appointment, ClinicProfile, Id, Patient } from "../domain/types.js";

export type MaybePromise<T> = T | Promise<T>;

export type PendingBooking = {
  appointmentId?: Id;
  serviceId: Id;
  professionalId: Id;
  startsAt: Date;
  endsAt: Date;
};

export type Conversation = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  botPaused: boolean;
  pendingBooking?: PendingBooking;
  createdAt: Date;
  updatedAt: Date;
};

export type PatientInterest = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  serviceId: Id;
  professionalId?: Id;
  preferredFrom: Date;
  preferredTo: Date;
  status: "active" | "fulfilled" | "expired";
};

export type ProcessedWebhookDeliveryInput = {
  provider: "kapso";
  idempotencyKey: string;
  clinicId: string;
  conversationId?: string;
  providerMessageId?: string;
};

export interface OperationalRepository {
  upsertClinicProfile(profile: ClinicProfile): MaybePromise<void>;
  getClinicProfile(clinicId: Id): MaybePromise<ClinicProfile | undefined>;
  upsertPatient(patient: Patient): MaybePromise<void>;
  getPatient(patientId: Id): MaybePromise<Patient | undefined>;
  saveConversation(conversation: Conversation): MaybePromise<void>;
  getConversation(conversationId: Id): MaybePromise<Conversation | undefined>;
  saveAppointment(appointment: Appointment): MaybePromise<void>;
  nextAppointmentId(): MaybePromise<Id>;
  withAppointmentLock<T>(appointmentId: Id, operation: () => Promise<T>): Promise<T>;
  getAppointment(appointmentId: Id): MaybePromise<Appointment | undefined>;
  listAppointmentsByPatient(patientId: Id): MaybePromise<Appointment[]>;
  saveInterest(interest: PatientInterest): MaybePromise<void>;
  listActiveInterests(): MaybePromise<PatientInterest[]>;
  markOptOut(whatsappNumber: string): MaybePromise<void>;
  isOptedOut(whatsappNumber: string): MaybePromise<boolean>;
  hasProcessedWebhookDelivery(idempotencyKey: string): MaybePromise<boolean>;
  markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): MaybePromise<void>;
}
```

- [ ] **Step 3: Move shared repository types out of memory adapter**

Modify `src/adapters/memory/repositories.ts`:

```ts
import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";
import type {
  Conversation,
  OperationalRepository,
  PatientInterest,
  PendingBooking,
  ProcessedWebhookDeliveryInput
} from "../../ports/repositories.js";

export type { Conversation, PatientInterest, PendingBooking };

export class InMemoryRepositories implements OperationalRepository {
  // keep existing implementation
}

function deliveryKey(input: string | ProcessedWebhookDeliveryInput) {
  return typeof input === "string" ? input : `${input.provider}:${input.idempotencyKey}`;
}
```

Update `hasProcessedWebhookDelivery()` and `markProcessedWebhookDelivery()` in the same file:

```ts
hasProcessedWebhookDelivery(idempotencyKey: string) {
  return this.processedWebhookDeliveries.has(idempotencyKey) || this.processedWebhookDeliveries.has(`kapso:${idempotencyKey}`);
}

markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
  this.processedWebhookDeliveries.add(deliveryKey(input));
}
```

- [ ] **Step 4: Update services to depend on the port and await repository reads/writes**

Modify `src/application/conversations/conversation-workflow.ts`:

```ts
import type { Conversation, OperationalRepository, PendingBooking } from "../../ports/repositories.js";
```

Change constructor dependency from `InMemoryRepositories` to `OperationalRepository`.

Make repository helpers async and await their calls:

```ts
async handleInboundMessage(input: InboundMessage): Promise<WorkflowResult> {
  await this.upsertPatient(input);
  const conversation = await this.upsertConversation(input);
  if (conversation.botPaused) {
    return { kind: "handoff", text: "Recepcion continua la conversacion por este mismo chat." };
  }
  // keep existing flow, await private handlers that read repos
}
```

Apply the same pattern throughout this file:
- `await this.repos.getConversation(...)`
- `await this.repos.saveConversation(...)`
- `await this.repos.getClinicProfile(...)`
- `await this.repos.getPatient(...)`
- `await this.repos.upsertPatient(...)`
- `await this.repos.listAppointmentsByPatient(...)`

Modify `src/application/scheduling/scheduling-service.ts`:

```ts
import type { OperationalRepository } from "../../ports/repositories.js";
```

Change constructor dependency to `OperationalRepository`, make `requireProfile()` async, and await repository calls:

```ts
const appointmentId = await this.repos.nextAppointmentId();
await this.repos.saveAppointment(appointment);
const appointment = await this.repos.getAppointment(input.appointmentId);
```

Modify `src/application/messaging/whatsapp-inbound-service.ts` and `src/application/messaging/outbound-template-service.ts` so constructor `repos` uses `OperationalRepository` and all repository calls are awaited.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/repository-port.test.ts tests/conversation-workflow.test.ts tests/scheduling-service.test.ts tests/kapso-webhook.test.ts tests/whatsapp-provider.test.ts
npm run typecheck
```

Expected: all listed tests pass and TypeScript passes.

Commit:

```bash
git add src/ports/repositories.ts src/adapters/memory/repositories.ts src/application/conversations/conversation-workflow.ts src/application/scheduling/scheduling-service.ts src/application/messaging/whatsapp-inbound-service.ts src/application/messaging/outbound-template-service.ts tests/repository-port.test.ts tests/conversation-workflow.test.ts tests/scheduling-service.test.ts tests/kapso-webhook.test.ts tests/whatsapp-provider.test.ts
git commit -m "refactor: add operational repository port"
```

## Task 2: Add Processed Webhook Delivery Schema and Prisma Test Helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260530020000_add_processed_webhook_deliveries/migration.sql`
- Create: `tests/helpers/prisma.ts`
- Modify: `tests/google-oauth.test.ts`
- Test: `tests/prisma-operational-repository.test.ts`

- [ ] **Step 1: Write failing schema/helper test**

Create `tests/prisma-operational-repository.test.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("Prisma operational persistence schema", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-operational-schema-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("stores processed webhook deliveries with provider-scoped uniqueness", async () => {
    await prisma.clinic.create({
      data: {
        id: "clinic_1",
        name: "Clinica Demo",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });

    await prisma.processedWebhookDelivery.create({
      data: {
        provider: "kapso",
        idempotencyKey: "delivery_1",
        clinicId: "clinic_1",
        conversationId: "conv_1",
        providerMessageId: "wamid.1"
      }
    });

    await expect(
      prisma.processedWebhookDelivery.create({
        data: {
          provider: "kapso",
          idempotencyKey: "delivery_1",
          clinicId: "clinic_1"
        }
      })
    ).rejects.toThrow();
  });
});
```

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts
```

Expected: FAIL because `tests/helpers/prisma.ts` and `processedWebhookDelivery` do not exist.

- [ ] **Step 2: Add shared Prisma test helper**

Create `tests/helpers/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PrismaTestContext = {
  prisma: PrismaClient;
  databasePath: string;
  cleanup(): Promise<void>;
};

export function createPrismaTestContext(prefix: string): PrismaTestContext {
  const tempDirectory = mkdtempSync(join(tmpdir(), prefix));
  const databasePath = join(tempDirectory, "test.db");
  applySqliteMigrations(databasePath);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });

  return {
    prisma,
    databasePath,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}

export function applySqliteMigrations(databasePath: string) {
  const migrationsPath = join(process.cwd(), "prisma", "migrations");
  const migrationSql = readdirSync(migrationsPath)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .map((entry) => readFileSync(join(migrationsPath, entry, "migration.sql"), "utf8"))
    .join("\n");

  execFileSync("sqlite3", [databasePath], { input: migrationSql });
}
```

Modify `tests/google-oauth.test.ts`:
- remove imports of `execFileSync`, `mkdtempSync`, `readdirSync`, `readFileSync`, `rmSync`, `tmpdir`, `join`;
- import `createPrismaTestContext, type PrismaTestContext` from `./helpers/prisma.js`;
- replace the local `tempDirectory`/`applySqliteMigrations` setup with:

```ts
let context: PrismaTestContext;

beforeAll(async () => {
  context = createPrismaTestContext("momentum-google-oauth-test-");
  prisma = context.prisma;
  repository = new PrismaCalendarCredentialRepository(prisma, cipher);
  // keep existing clinic upsert
});

afterAll(async () => {
  await context.cleanup();
});
```

Delete the local `applySqliteMigrations()` function at the bottom of `tests/google-oauth.test.ts`.

- [ ] **Step 3: Add Prisma model and migration**

Modify `prisma/schema.prisma`.

Add relation to `Clinic`:

```prisma
processedWebhookDeliveries ProcessedWebhookDelivery[]
```

Add model:

```prisma
model ProcessedWebhookDelivery {
  id                String   @id @default(cuid())
  provider          String
  idempotencyKey    String
  clinicId          String
  conversationId    String?
  providerMessageId String?
  processedAt       DateTime @default(now())
  clinic            Clinic   @relation(fields: [clinicId], references: [id])

  @@unique([provider, idempotencyKey])
  @@index([clinicId, processedAt])
}
```

Create `prisma/migrations/20260530020000_add_processed_webhook_deliveries/migration.sql`:

```sql
CREATE TABLE "ProcessedWebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "providerMessageId" TEXT,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedWebhookDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProcessedWebhookDelivery_provider_idempotencyKey_key" ON "ProcessedWebhookDelivery"("provider", "idempotencyKey");
CREATE INDEX "ProcessedWebhookDelivery_clinicId_processedAt_idx" ON "ProcessedWebhookDelivery"("clinicId", "processedAt");
```

Run:

```bash
npm run prisma:generate
```

Expected: Prisma client regenerates without schema errors.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts tests/google-oauth.test.ts
npx prisma validate
npm run typecheck
```

Expected: schema test, Google OAuth tests, Prisma validate, and typecheck pass.

Commit:

```bash
git add prisma/schema.prisma prisma/migrations/20260530020000_add_processed_webhook_deliveries/migration.sql tests/helpers/prisma.ts tests/google-oauth.test.ts tests/prisma-operational-repository.test.ts package-lock.json package.json
git commit -m "feat: add processed webhook delivery schema"
```

## Task 3: Add Prisma Audit Log

**Files:**
- Create: `src/adapters/prisma/audit-log.ts`
- Modify: `tests/prisma-operational-repository.test.ts`

- [ ] **Step 1: Add failing Prisma audit tests**

Append to `tests/prisma-operational-repository.test.ts`:

```ts
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";

describe("PrismaAuditLog", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-audit-");
    prisma = context.prisma;
    await prisma.clinic.create({
      data: {
        id: "clinic_audit",
        name: "Audit Clinic",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("records audit events and parses metadata on return", async () => {
    const audit = new PrismaAuditLog(prisma);

    const event = await audit.record({
      clinicId: "clinic_audit",
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: { idempotencyKey: "delivery_1", provider: "kapso" }
    });

    expect(event).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        clinicId: "clinic_audit",
        type: "whatsapp.inbound.accepted",
        message: "Accepted WhatsApp inbound delivery",
        metadata: { idempotencyKey: "delivery_1", provider: "kapso" },
        createdAt: expect.any(Date)
      })
    );
  });
});
```

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts
```

Expected: FAIL because `PrismaAuditLog` does not exist.

- [ ] **Step 2: Implement Prisma audit log**

Create `src/adapters/prisma/audit-log.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { AuditEvent, AuditEventInput, AuditLogPort } from "../../ports/audit-log.js";

type AuditEventRecord = {
  id: string;
  clinicId: string;
  conversationId: string | null;
  type: string;
  message: string;
  metadataJson: string;
  createdAt: Date;
};

export class PrismaAuditLog implements AuditLogPort {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event = await this.prisma.auditEvent.create({
      data: {
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        type: input.type,
        message: input.message,
        metadataJson: JSON.stringify(input.metadata)
      }
    });

    return toAuditEvent(event);
  }
}

function toAuditEvent(event: AuditEventRecord): AuditEvent {
  return {
    id: event.id,
    clinicId: event.clinicId,
    conversationId: event.conversationId ?? undefined,
    type: event.type,
    message: event.message,
    metadata: parseMetadata(event.metadataJson),
    createdAt: event.createdAt
  };
}

function parseMetadata(metadataJson: string): Record<string, string> {
  const metadata = JSON.parse(metadataJson) as unknown;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.values(metadata).some((value) => typeof value !== "string")
  ) {
    throw new Error("Invalid audit event metadata");
  }
  return { ...(metadata as Record<string, string>) };
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts tests/audit-log.test.ts
npm run typecheck
```

Expected: Prisma operational tests, existing audit tests, and typecheck pass.

Commit:

```bash
git add src/adapters/prisma/audit-log.ts tests/prisma-operational-repository.test.ts
git commit -m "feat: add prisma audit log"
```

## Task 4: Add Prisma Operational Repository Core State

**Files:**
- Create: `src/adapters/prisma/operational-repository.ts`
- Modify: `tests/prisma-operational-repository.test.ts`

- [ ] **Step 1: Add failing repository core tests**

Append to `tests/prisma-operational-repository.test.ts`:

```ts
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("PrismaOperationalRepository core state", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repos: PrismaOperationalRepository;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-repos-core-");
    prisma = context.prisma;
    repos = new PrismaOperationalRepository(prisma);
    await repos.upsertClinicProfile(demoProfile());
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("round-trips seeded clinic profile from the process profile cache", async () => {
    expect(await repos.getClinicProfile("clinic_1")).toEqual(demoProfile());
  });

  it("round-trips patients and conversations with pending booking", async () => {
    await repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    await repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: true,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:05:00.000Z")
    });

    expect(await repos.getPatient("pat_1")).toEqual({
      id: "pat_1",
      whatsappNumber: "+5491111111111",
      fullName: "Ana Gomez"
    });
    expect(await repos.getConversation("conv_1")).toEqual(
      expect.objectContaining({
        id: "conv_1",
        clinicId: "clinic_1",
        patientId: "pat_1",
        botPaused: true,
        pendingBooking: {
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          startsAt: new Date("2026-06-01T13:00:00.000Z"),
          endsAt: new Date("2026-06-01T13:30:00.000Z")
        }
      })
    );
  });

  it("persists opt-out state by WhatsApp number", async () => {
    await repos.upsertPatient({ id: "pat_opt_out", whatsappNumber: "+5491111112222" });
    await repos.markOptOut("+5491111112222");

    expect(await repos.isOptedOut("+5491111112222")).toBe(true);
    expect(await repos.isOptedOut("+5491111113333")).toBe(false);
  });

  it("persists webhook idempotency across repository instances", async () => {
    await repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: "delivery_1",
      clinicId: "clinic_1",
      conversationId: "conv_1",
      providerMessageId: "wamid.1"
    });
    await repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: "delivery_1",
      clinicId: "clinic_1",
      conversationId: "conv_1",
      providerMessageId: "wamid.1"
    });

    const freshRepos = new PrismaOperationalRepository(prisma);
    expect(await freshRepos.hasProcessedWebhookDelivery("delivery_1")).toBe(true);
  });
});

function demoProfile() {
  return parseClinicProfile({
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
        restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts
```

Expected: FAIL because `PrismaOperationalRepository` does not exist.

- [ ] **Step 2: Implement core Prisma repository**

Create `src/adapters/prisma/operational-repository.ts` with:
- class `PrismaOperationalRepository implements OperationalRepository`;
- private `clinicProfiles = new Map<string, ClinicProfile>()`;
- `upsertClinicProfile()` stores a cloned profile in the map and upserts `Clinic`, `Service`, `Professional`, and `ServiceProfessional` rows;
- patient/conversation CRUD;
- pending booking JSON with ISO date strings;
- opt-out through `Patient.optedOut`;
- idempotency through `ProcessedWebhookDelivery`.

Use these helper signatures:

```ts
function serializePendingBooking(pendingBooking: PendingBooking | undefined): string | null
function parsePendingBooking(json: string | null): PendingBooking | undefined
function cloneClinicProfile(profile: ClinicProfile): ClinicProfile
function cloneConversation(conversation: Conversation): Conversation
function toPatient(record: { id: string; whatsappNumber: string; fullName: string | null }): Patient
```

Implement idempotency duplicate handling:

```ts
async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
  const delivery =
    typeof input === "string"
      ? { provider: "kapso" as const, idempotencyKey: input, clinicId: "clinic_1" }
      : input;
  try {
    await this.prisma.processedWebhookDelivery.create({ data: delivery });
  } catch (error) {
    if (isPrismaUniqueConflict(error)) return;
    throw error;
  }
}
```

Use Prisma error code `P2002` in `isPrismaUniqueConflict()`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts tests/repository-port.test.ts
npm run typecheck
```

Expected: repository tests and typecheck pass.

Commit:

```bash
git add src/adapters/prisma/operational-repository.ts tests/prisma-operational-repository.test.ts
git commit -m "feat: add prisma operational repository core"
```

## Task 5: Persist Appointments, Interests, IDs, and Locks

**Files:**
- Modify: `src/adapters/prisma/operational-repository.ts`
- Modify: `tests/prisma-operational-repository.test.ts`

- [ ] **Step 1: Add failing appointments/interests tests**

Append to `PrismaOperationalRepository core state` in `tests/prisma-operational-repository.test.ts`:

```ts
it("generates process-independent appointment ids", async () => {
  const id = await repos.nextAppointmentId();
  expect(id).toMatch(/^appt_[0-9a-f-]{36}$/u);
});

it("round-trips appointments by id and patient", async () => {
  await repos.upsertPatient({ id: "pat_appt", whatsappNumber: "+5491111114444" });
  await repos.saveAppointment({
    id: "appt_1",
    clinicId: "clinic_1",
    patientId: "pat_appt",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    calendarEventId: "google_evt_1",
    calendarId: "cal_perez",
    startsAt: new Date("2026-06-01T13:00:00.000Z"),
    endsAt: new Date("2026-06-01T13:30:00.000Z"),
    status: "scheduled"
  });

  expect(await repos.getAppointment("appt_1")).toEqual({
    id: "appt_1",
    clinicId: "clinic_1",
    patientId: "pat_appt",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    calendarEventId: "google_evt_1",
    calendarId: "cal_perez",
    startsAt: new Date("2026-06-01T13:00:00.000Z"),
    endsAt: new Date("2026-06-01T13:30:00.000Z"),
    status: "scheduled"
  });
  expect(await repos.listAppointmentsByPatient("pat_appt")).toEqual([
    expect.objectContaining({ id: "appt_1", status: "scheduled" })
  ]);
});

it("round-trips active patient interests", async () => {
  await repos.upsertPatient({ id: "pat_interest", whatsappNumber: "+5491111115555" });
  await repos.saveInterest({
    id: "interest_1",
    clinicId: "clinic_1",
    patientId: "pat_interest",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    preferredFrom: new Date("2026-06-01T12:00:00.000Z"),
    preferredTo: new Date("2026-06-01T16:00:00.000Z"),
    status: "active"
  });
  await repos.saveInterest({
    id: "interest_2",
    clinicId: "clinic_1",
    patientId: "pat_interest",
    serviceId: "svc_botox",
    preferredFrom: new Date("2026-06-02T12:00:00.000Z"),
    preferredTo: new Date("2026-06-02T16:00:00.000Z"),
    status: "fulfilled"
  });

  expect(await repos.listActiveInterests()).toEqual([
    expect.objectContaining({ id: "interest_1", professionalId: "pro_perez", status: "active" })
  ]);
});

it("serializes appointment lock operations in process", async () => {
  const events: string[] = [];

  await Promise.all([
    repos.withAppointmentLock("appt_lock", async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first:end");
    }),
    repos.withAppointmentLock("appt_lock", async () => {
      events.push("second:start");
      events.push("second:end");
    })
  ]);

  expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
});
```

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts
```

Expected: FAIL because appointment, interest, id, or lock methods are not complete.

- [ ] **Step 2: Implement appointments, interests, ids, and locks**

Modify `src/adapters/prisma/operational-repository.ts`:
- `nextAppointmentId()` returns `appt_${randomUUID()}`;
- appointment save uses Prisma `upsert`;
- appointment reads convert records to domain `Appointment`;
- `listAppointmentsByPatient()` orders by `startsAt`;
- interest save uses Prisma `upsert`;
- `listActiveInterests()` filters `status: "active"` and maps optional `professionalId`;
- `withAppointmentLock()` copies the in-memory queue pattern used by `InMemoryRepositories`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts tests/scheduling-service.test.ts tests/outbound-policies.test.ts
npm run typecheck
```

Expected: all listed tests and typecheck pass.

Commit:

```bash
git add src/adapters/prisma/operational-repository.ts tests/prisma-operational-repository.test.ts
git commit -m "feat: persist operational appointments and interests"
```

## Task 6: Prove Restart and Duplicate Webhook Persistence

**Files:**
- Create: `tests/prisma-runtime-persistence.test.ts`

- [ ] **Step 1: Write failing restart and duplicate tests**

Create `tests/prisma-runtime-persistence.test.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("Prisma-backed runtime persistence", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-prisma-runtime-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("continues a pending booking after replacing repository and workflow instances", async () => {
    const first = await buildRuntime(prisma);
    await first.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Quiero reservar botox"
    });

    const second = await buildRuntime(prisma);
    const confirm = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "si"
    });

    expect(confirm).toEqual({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });

    const final = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Ana Gomez"
    });

    expect(final.kind).toBe("reply");
    expect(final.text).toContain("Turno confirmado");
    expect(await second.repos.listAppointmentsByPatient("pat_restart")).toHaveLength(1);
  });

  it("ignores duplicate webhook deliveries after replacing service instances", async () => {
    const first = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await firstService.handleInboundMessage(inbound("delivery_restart"));

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: second.audit
    });
    const duplicate = await secondService.handleInboundMessage(inbound("delivery_restart"));

    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });
});

async function buildRuntime(prisma: PrismaClient) {
  const repos = new PrismaOperationalRepository(prisma);
  await repos.upsertClinicProfile(profile());
  const audit = new PrismaAuditLog(prisma);
  const calendar = new FakeCalendar();
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
  ]);
  const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date("2026-05-29T12:00:00.000Z"));

  return { repos, audit, calendar, scheduling, workflow };
}

function profile() {
  return parseClinicProfile({
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
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function inbound(idempotencyKey: string) {
  return {
    clinicId: "clinic_1",
    providerPhoneNumberId: "123456789012345",
    providerMessageId: "wamid.restart",
    conversationId: "conv_duplicate_restart",
    patientId: "pat_duplicate_restart",
    whatsappNumber: "+5491111117777",
    text: "hola",
    idempotencyKey,
    receivedAt: new Date("2026-05-29T12:00:00.000Z")
  };
}

class FixedWorkflow {
  async handleInboundMessage() {
    return { kind: "reply" as const, text: "Respuesta persistente." };
  }
}
```

Run:

```bash
npm test -- tests/prisma-runtime-persistence.test.ts
```

Expected: FAIL until Prisma repo behavior from previous tasks is fully compatible with workflow and inbound service.

- [ ] **Step 2: Apply the exact integration fixes**

Make these changes in already-created files so the restart and duplicate tests pass.

Modify `src/application/messaging/whatsapp-inbound-service.ts` so successful sends mark processed deliveries with structured metadata:

```ts
await this.options.repos.markProcessedWebhookDelivery({
  provider: "kapso",
  idempotencyKey: message.idempotencyKey,
  clinicId: message.clinicId,
  conversationId: message.conversationId,
  providerMessageId: message.providerMessageId
});
```

Run this scan and fix every remaining unawaited repository read/write in workflow and scheduling files:

```bash
rg -n "this\\.repos\\.(get|save|upsert|list|mark|is|next)" src/application/conversations/conversation-workflow.ts src/application/scheduling/scheduling-service.ts
```

Each match inside an async method must be preceded by `await`, except `this.repos.withAppointmentLock(...)` when it is immediately returned.

In `src/adapters/prisma/operational-repository.ts`, `upsertClinicProfile()` must create or update these rows before any appointment save can run:
- `Clinic`
- `Service`
- `Professional`
- `ServiceProfessional`

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/prisma-runtime-persistence.test.ts tests/kapso-webhook.test.ts tests/conversation-workflow.test.ts
npm run typecheck
```

Expected: restart persistence tests, webhook tests, conversation tests, and typecheck pass.

Commit:

```bash
git add tests/prisma-runtime-persistence.test.ts src/application/messaging/whatsapp-inbound-service.ts src/application/conversations/conversation-workflow.ts src/application/scheduling/scheduling-service.ts src/adapters/prisma/operational-repository.ts
git commit -m "test: prove prisma runtime persistence"
```

## Task 7: Wire Real Kapso Runtime to Prisma

**Files:**
- Create: `src/dev/demo-clinic-profile.ts`
- Modify: `src/dev/seed.ts`
- Modify: `src/server.ts`
- Test: `tests/simulation-api.test.ts`
- Test: `tests/kapso-webhook.test.ts`

- [ ] **Step 1: Extract shared demo clinic profile**

Create `src/dev/demo-clinic-profile.ts`:

```ts
import { parseClinicProfile } from "../domain/clinic-profile.js";

export function buildDemoClinicProfile() {
  return parseClinicProfile({
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
        restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [
          { day: 1, startTime: "09:00", endTime: "17:00" },
          { day: 2, startTime: "09:00", endTime: "17:00" },
          { day: 3, startTime: "09:00", endTime: "17:00" },
          { day: 4, startTime: "09:00", endTime: "17:00" },
          { day: 5, startTime: "09:00", endTime: "17:00" }
        ]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

Modify `src/dev/seed.ts` to call:

```ts
repos.upsertClinicProfile(buildDemoClinicProfile());
```

Also export `buildDefaultCalendar()` from `src/dev/seed.ts` so the server can build the same fallback calendar without constructing the full in-memory container:

```ts
export function buildDefaultCalendar(calendarProvider: CalendarProvider = "fake"): CalendarPort {
  return calendarProvider === "google" ? new MissingGoogleCalendar() : new FakeCalendar();
}
```

Run:

```bash
npm test -- tests/simulation-api.test.ts tests/conversation-workflow.test.ts
```

Expected: simulation and conversation behavior remain unchanged.

- [ ] **Step 2: Wire server runtime to shared Prisma client**

Modify `src/server.ts`:
- create one shared PrismaClient when `calendarProvider === "google"` or `whatsappConfig.provider === "kapso"`;
- pass it into `buildGoogleCalendarRuntime(prisma)`;
- pass it into `buildWhatsAppRuntime({ prisma, config, calendarProvider, calendar })`;
- use `PrismaOperationalRepository`, `PrismaAuditLog`, `buildDemoClinicProfile()`, `SchedulingService`, and `ConversationWorkflow` inside `buildWhatsAppRuntime()`;
- import `buildDefaultCalendar` from `src/dev/seed.ts` for the non-Google calendar fallback;
- disconnect the shared Prisma client once in `shutdown()`.

The Kapso runtime construction should look like:

```ts
const repos = new PrismaOperationalRepository(input.prisma);
await repos.upsertClinicProfile(buildDemoClinicProfile());
const audit = new PrismaAuditLog(input.prisma);
const scheduling = new SchedulingService(repos, input.calendar ?? buildDefaultCalendar(input.calendarProvider), audit);
const workflow = new ConversationWorkflow(repos, scheduling, audit);
```

Because top-level startup is already async, `buildWhatsAppRuntime()` may become async and be awaited before `buildApp()`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/simulation-api.test.ts tests/kapso-webhook.test.ts tests/google-oauth.test.ts
npm run typecheck
```

Expected: simulation remains memory-backed, Kapso route tests pass, Google OAuth tests pass, and typecheck passes.

Commit:

```bash
git add src/dev/demo-clinic-profile.ts src/dev/seed.ts src/server.ts tests/simulation-api.test.ts tests/kapso-webhook.test.ts
git commit -m "feat: wire kapso runtime to prisma persistence"
```

## Task 8: Document Operational Persistence and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document runtime persistence**

Add to `README.md` under Kapso setup:

````md
When `WHATSAPP_PROVIDER=kapso`, Momentum stores operational patient-agent state in Prisma:

- patients;
- conversations and pending bookings;
- appointments;
- opt-out;
- processed webhook delivery keys;
- audit events.

Run Prisma migrations before real webhook testing:

```bash
npm run prisma:migrate -- --name init
```
````

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test -- --run
npm run typecheck
npx prisma validate
git status --short
```

Expected:
- all tests pass;
- TypeScript passes;
- Prisma schema is valid;
- git status shows only intended README changes before commit.

- [ ] **Step 3: Commit docs**

```bash
git add README.md
git commit -m "docs: document prisma operational persistence"
```

## Plan Self-Review

- Spec coverage: repository persistence is covered by Tasks 1, 4, and 5; audit by Task 3; webhook idempotency by Tasks 2, 4, and 6; runtime wiring by Task 7; docs and final verification by Task 8.
- Plan scan: no red-flag filler text or unspecified future behavior remains in task steps.
- Type consistency: `OperationalRepository`, `ProcessedWebhookDeliveryInput`, `PrismaOperationalRepository`, and `PrismaAuditLog` names are introduced before later tasks use them.
- Scope check: dashboard, onboarding UI, analytics, schedulers, OpenAI intent interpretation, Outlook, and editable clinic configuration are not included.
