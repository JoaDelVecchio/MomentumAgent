# Outbound Automation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable outbound automation engine for appointment reminders, warm-lead reactivation, and freed-slot offers through approved WhatsApp templates.

**Architecture:** Add provider-neutral outbound delivery state to `OperationalRepository`, persist it in memory and Prisma, then introduce an `OutboundAutomationService` that coordinates repositories, calendar verification, template sending, opt-out, handoff pause, quiet hours, and audit logging. Wire the service into the real Kapso runtime and expose a token-protected internal run route for cron/manual execution while keeping freed-slot offers triggered by scheduling changes.

**Tech Stack:** Node.js 22, TypeScript, Vitest, Prisma SQLite, Fastify, existing WhatsApp provider port, existing CalendarPort, existing AuditLogPort.

---

## Scope Check

This plan implements only the outbound automation block:
- generic outbound delivery state and idempotency;
- reminder automation;
- warm abandoned-booking reactivation;
- freed-slot offer automation;
- quiet-hour and opt-out blocking;
- runtime wiring and an internal run route.

It does not implement a dashboard, campaign builder, cold outreach, payments, customer-managed template editing, Outlook-specific scheduling, or a staff/internal WhatsApp agent.

## File Structure

- `src/ports/repositories.ts`: add outbound delivery types, claims, query methods, and appointment/conversation list methods needed by automation.
- `src/adapters/memory/repositories.ts`: in-memory implementation of outbound delivery state and new list methods for tests/simulation.
- `prisma/schema.prisma`: add `OutboundDelivery` model.
- `prisma/migrations/20260530120000_add_outbound_deliveries/migration.sql`: migration for durable outbound delivery state.
- `src/adapters/prisma/operational-repository.ts`: Prisma implementation of outbound delivery claim/update/query methods and list methods.
- `src/application/outbound/quiet-hours.ts`: clinic-time quiet-hour helper using `Intl.DateTimeFormat`.
- `src/application/outbound/templates.ts`: Momentum-owned template names and template parameter builders.
- `src/application/outbound/outbound-automation-service.ts`: reminder, reactivation, and freed-slot orchestration.
- `src/application/scheduling/scheduling-service.ts`: optional freed-slot handler invoked after successful cancel/reschedule.
- `src/api/outbound-routes.ts`: token-protected internal route to run due reminders/reactivations.
- `src/api/app.ts`: register outbound routes when configured.
- `src/config/outbound.ts`: read internal route token.
- `src/runtime/server-runtime.ts`: create `OutboundTemplateService` and `OutboundAutomationService` for real Kapso runtime.
- `src/server.ts`: wire outbound config/route.
- `README.md`: document how to run outbound automation locally.
- `tests/outbound-delivery-repository.test.ts`: repository port/memory tests.
- `tests/outbound-automation-helpers.test.ts`: quiet-hour and template tests.
- `tests/outbound-automation-reminders.test.ts`: reminder behavior.
- `tests/outbound-automation-reactivation.test.ts`: reactivation behavior.
- `tests/outbound-automation-freed-slot.test.ts`: freed-slot behavior and scheduling integration.
- `tests/outbound-routes.test.ts`: internal route behavior.
- `tests/prisma-operational-repository.test.ts`: Prisma outbound delivery persistence tests.
- `tests/server-runtime.test.ts`: runtime wiring assertion.

## Task 1: Add Outbound Repository Contract And Memory Implementation

**Files:**
- Modify: `src/ports/repositories.ts`
- Modify: `src/adapters/memory/repositories.ts`
- Create: `tests/outbound-delivery-repository.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

Create `tests/outbound-delivery-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("outbound delivery repository contract", () => {
  it("claims an outbound delivery once and records sent status", async () => {
    const repos = new InMemoryRepositories();
    await repos.upsertClinicProfile(profile());

    const first = await repos.claimOutboundDelivery({
      key: "reminder:appt_1:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111111111",
      patientId: "pat_1",
      appointmentId: "appt_1",
      templateName: "appointment_reminder_24h",
      metadata: { kind: "24h" },
      now: new Date("2026-06-01T12:00:00.000Z")
    });
    const duplicate = await repos.claimOutboundDelivery({
      key: "reminder:appt_1:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111111111",
      patientId: "pat_1",
      appointmentId: "appt_1",
      templateName: "appointment_reminder_24h",
      metadata: { kind: "24h" },
      now: new Date("2026-06-01T12:01:00.000Z")
    });

    expect(first.kind).toBe("new");
    expect(duplicate.kind).toBe("existing");

    await repos.markOutboundDeliverySent({
      key: "reminder:appt_1:24h",
      providerMessageId: "wamid.1",
      sentAt: new Date("2026-06-01T12:02:00.000Z")
    });

    expect(await repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({
        key: "reminder:appt_1:24h",
        status: "sent",
        providerMessageId: "wamid.1",
        sentAt: new Date("2026-06-01T12:02:00.000Z")
      })
    );
  });

  it("lists scheduled appointments and clinic conversations for automation scans", async () => {
    const repos = new InMemoryRepositories();
    await repos.upsertClinicProfile(profile());
    await repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111" });
    await repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      createdAt: new Date("2026-05-30T12:00:00.000Z"),
      updatedAt: new Date("2026-05-30T12:00:00.000Z")
    });
    await repos.saveAppointment({
      id: "appt_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "evt_1",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-03T12:00:00.000Z"),
      endsAt: new Date("2026-06-03T12:30:00.000Z"),
      status: "scheduled"
    });

    await expect(
      repos.listScheduledAppointments({
        clinicId: "clinic_1",
        from: new Date("2026-06-03T00:00:00.000Z"),
        to: new Date("2026-06-04T00:00:00.000Z")
      })
    ).resolves.toEqual([expect.objectContaining({ id: "appt_1" })]);

    await expect(repos.listConversationsByClinic("clinic_1")).resolves.toEqual([
      expect.objectContaining({ id: "conv_1", patientId: "pat_1" })
    ]);
    await expect(repos.listConversationsByPatient({ clinicId: "clinic_1", patientId: "pat_1" })).resolves.toEqual([
      expect.objectContaining({ id: "conv_1" })
    ]);
  });
});

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
        workingHours: [{ day: 3, startTime: "09:00", endTime: "18:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-delivery-repository.test.ts
```

Expected: FAIL because `claimOutboundDelivery`, outbound types, and list methods do not exist.

- [ ] **Step 3: Extend repository port**

Modify `src/ports/repositories.ts` by adding these types after `WebhookDeliveryOutcomeInput`:

```ts
export type OutboundAutomationType = "reminder" | "reactivation" | "freed_slot";

export type OutboundDeliveryStatus = "claimed" | "sent" | "failed" | "blocked";

export type OutboundDeliveryClaimInput = {
  key: string;
  clinicId: Id;
  automationType: OutboundAutomationType;
  toWhatsappNumber: string;
  patientId?: Id;
  conversationId?: Id;
  appointmentId?: Id;
  templateName: string;
  metadata: Record<string, string>;
  now: Date;
};

export type OutboundDeliveryRecord = Omit<OutboundDeliveryClaimInput, "now"> & {
  id: Id;
  status: OutboundDeliveryStatus;
  providerMessageId?: string;
  failureReason?: string;
  claimedAt: Date;
  sentAt?: Date;
  blockedAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type OutboundDeliveryClaim =
  | { kind: "new"; delivery: OutboundDeliveryRecord }
  | { kind: "existing"; delivery: OutboundDeliveryRecord };

export type ListScheduledAppointmentsInput = {
  clinicId: Id;
  from: Date;
  to: Date;
};

export type ConversationByPatientLookup = {
  clinicId: Id;
  patientId: Id;
};
```

Then add these methods to `OperationalRepository`:

```ts
  listScheduledAppointments(input: ListScheduledAppointmentsInput): MaybePromise<Appointment[]>;
  listConversationsByClinic(clinicId: Id): MaybePromise<Conversation[]>;
  listConversationsByPatient(lookup: ConversationByPatientLookup): MaybePromise<Conversation[]>;
  claimOutboundDelivery(input: OutboundDeliveryClaimInput): MaybePromise<OutboundDeliveryClaim>;
  getOutboundDelivery(key: string): MaybePromise<OutboundDeliveryRecord | undefined>;
  markOutboundDeliverySent(input: {
    key: string;
    providerMessageId: string;
    sentAt: Date;
  }): MaybePromise<void>;
  markOutboundDeliveryBlocked(input: {
    key: string;
    reason: string;
    blockedAt: Date;
  }): MaybePromise<void>;
  markOutboundDeliveryFailed(input: {
    key: string;
    reason: string;
    failedAt: Date;
  }): MaybePromise<void>;
```

- [ ] **Step 4: Implement memory repository methods**

Modify `src/adapters/memory/repositories.ts`:

1. Import the new types from `../../ports/repositories.js`.
2. Add a map and counter to `InMemoryRepositories`:

```ts
  private outboundDeliveries = new Map<string, OutboundDeliveryRecord>();
  private outboundDeliveryCounter = 0;
```

3. Add these methods inside the class:

```ts
  listScheduledAppointments(input: ListScheduledAppointmentsInput) {
    return [...this.appointments.values()]
      .filter(
        (appointment) =>
          appointment.clinicId === input.clinicId &&
          appointment.status === "scheduled" &&
          appointment.startsAt >= input.from &&
          appointment.startsAt <= input.to
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((appointment) => cloneAppointment(appointment));
  }

  listConversationsByClinic(clinicId: Id) {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.clinicId === clinicId)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map((conversation) => cloneConversation(conversation));
  }

  listConversationsByPatient(lookup: ConversationByPatientLookup) {
    return [...this.conversations.values()]
      .filter(
        (conversation) =>
          conversation.clinicId === lookup.clinicId && conversation.patientId === lookup.patientId
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((conversation) => cloneConversation(conversation));
  }

  claimOutboundDelivery(input: OutboundDeliveryClaimInput): OutboundDeliveryClaim {
    const existing = this.outboundDeliveries.get(input.key);
    if (existing) {
      return { kind: "existing", delivery: cloneOutboundDelivery(existing) };
    }

    this.outboundDeliveryCounter += 1;
    const delivery: OutboundDeliveryRecord = {
      id: `outbound_${this.outboundDeliveryCounter}`,
      key: input.key,
      clinicId: input.clinicId,
      automationType: input.automationType,
      toWhatsappNumber: input.toWhatsappNumber,
      patientId: input.patientId,
      conversationId: input.conversationId,
      appointmentId: input.appointmentId,
      templateName: input.templateName,
      metadata: { ...input.metadata },
      status: "claimed",
      claimedAt: new Date(input.now),
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now)
    };
    this.outboundDeliveries.set(input.key, delivery);
    return { kind: "new", delivery: cloneOutboundDelivery(delivery) };
  }

  getOutboundDelivery(key: string) {
    const delivery = this.outboundDeliveries.get(key);
    return delivery ? cloneOutboundDelivery(delivery) : undefined;
  }

  markOutboundDeliverySent(input: { key: string; providerMessageId: string; sentAt: Date }) {
    const existing = this.requireOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...existing,
      status: "sent",
      providerMessageId: input.providerMessageId,
      sentAt: new Date(input.sentAt),
      updatedAt: new Date(input.sentAt)
    });
  }

  markOutboundDeliveryBlocked(input: { key: string; reason: string; blockedAt: Date }) {
    const existing = this.requireOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...existing,
      status: "blocked",
      failureReason: input.reason,
      blockedAt: new Date(input.blockedAt),
      updatedAt: new Date(input.blockedAt)
    });
  }

  markOutboundDeliveryFailed(input: { key: string; reason: string; failedAt: Date }) {
    const existing = this.requireOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...existing,
      status: "failed",
      failureReason: input.reason,
      failedAt: new Date(input.failedAt),
      updatedAt: new Date(input.failedAt)
    });
  }

  private requireOutboundDelivery(key: string) {
    const delivery = this.outboundDeliveries.get(key);
    if (!delivery) {
      throw new Error(`Outbound delivery ${key} not found`);
    }
    return delivery;
  }
```

4. Add this clone helper after `cloneWebhookDelivery`:

```ts
function cloneOutboundDelivery(delivery: OutboundDeliveryRecord): OutboundDeliveryRecord {
  return {
    ...delivery,
    metadata: { ...delivery.metadata },
    claimedAt: new Date(delivery.claimedAt),
    createdAt: new Date(delivery.createdAt),
    updatedAt: new Date(delivery.updatedAt),
    ...(delivery.sentAt ? { sentAt: new Date(delivery.sentAt) } : {}),
    ...(delivery.blockedAt ? { blockedAt: new Date(delivery.blockedAt) } : {}),
    ...(delivery.failedAt ? { failedAt: new Date(delivery.failedAt) } : {})
  };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/outbound-delivery-repository.test.ts tests/repository-port.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/ports/repositories.ts src/adapters/memory/repositories.ts tests/outbound-delivery-repository.test.ts
git commit -m "feat: add outbound delivery repository port"
```

Expected: commit succeeds.

## Task 2: Add Prisma Outbound Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260530120000_add_outbound_deliveries/migration.sql`
- Modify: `src/adapters/prisma/operational-repository.ts`
- Modify: `tests/prisma-operational-repository.test.ts`

- [ ] **Step 1: Write failing Prisma persistence tests**

Append this describe block to `tests/prisma-operational-repository.test.ts`:

```ts
describe("PrismaOperationalRepository outbound deliveries", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repos: PrismaOperationalRepository;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-outbound-");
    prisma = context.prisma;
    repos = new PrismaOperationalRepository(prisma);
    await repos.upsertClinicProfile(demoProfile());
    await repos.upsertPatient({ id: "pat_outbound", whatsappNumber: "+5491111114444" });
    await repos.saveConversation({
      id: "conv_outbound",
      clinicId: "clinic_1",
      patientId: "pat_outbound",
      botPaused: false,
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });
    await repos.saveAppointment({
      id: "appt_outbound",
      clinicId: "clinic_1",
      patientId: "pat_outbound",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "evt_outbound",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-03T12:00:00.000Z"),
      endsAt: new Date("2026-06-03T12:30:00.000Z"),
      status: "scheduled"
    });
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("claims outbound deliveries with durable unique keys", async () => {
    const first = await repos.claimOutboundDelivery({
      key: "reminder:appt_outbound:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111114444",
      patientId: "pat_outbound",
      appointmentId: "appt_outbound",
      templateName: "appointment_reminder_24h",
      metadata: { kind: "24h" },
      now: new Date("2026-06-02T12:00:00.000Z")
    });
    const secondRepository = new PrismaOperationalRepository(prisma);
    const duplicate = await secondRepository.claimOutboundDelivery({
      key: "reminder:appt_outbound:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111114444",
      patientId: "pat_outbound",
      appointmentId: "appt_outbound",
      templateName: "appointment_reminder_24h",
      metadata: { kind: "24h" },
      now: new Date("2026-06-02T12:01:00.000Z")
    });

    expect(first.kind).toBe("new");
    expect(duplicate.kind).toBe("existing");

    await secondRepository.markOutboundDeliverySent({
      key: "reminder:appt_outbound:24h",
      providerMessageId: "wamid.outbound",
      sentAt: new Date("2026-06-02T12:02:00.000Z")
    });

    expect(await repos.getOutboundDelivery("reminder:appt_outbound:24h")).toEqual(
      expect.objectContaining({
        key: "reminder:appt_outbound:24h",
        status: "sent",
        providerMessageId: "wamid.outbound",
        sentAt: new Date("2026-06-02T12:02:00.000Z"),
        metadata: { kind: "24h" }
      })
    );
  });

  it("lists scheduled appointments and conversations from Prisma", async () => {
    await expect(
      repos.listScheduledAppointments({
        clinicId: "clinic_1",
        from: new Date("2026-06-03T00:00:00.000Z"),
        to: new Date("2026-06-04T00:00:00.000Z")
      })
    ).resolves.toEqual([expect.objectContaining({ id: "appt_outbound" })]);

    await expect(repos.listConversationsByClinic("clinic_1")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "conv_outbound" })])
    );
    await expect(
      repos.listConversationsByPatient({ clinicId: "clinic_1", patientId: "pat_outbound" })
    ).resolves.toEqual([expect.objectContaining({ id: "conv_outbound" })]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts
```

Expected: FAIL because Prisma schema and repository methods are missing.

- [ ] **Step 3: Add Prisma model and migration**

Add this model to `prisma/schema.prisma`:

```prisma
model OutboundDelivery {
  id                String   @id
  clinicId          String
  deliveryKey       String   @unique
  automationType    String
  status            String
  toWhatsappNumber  String
  patientId         String?
  conversationId    String?
  appointmentId     String?
  templateName      String
  metadataJson      String
  providerMessageId String?
  failureReason     String?
  claimedAt         DateTime
  sentAt            DateTime?
  blockedAt         DateTime?
  failedAt          DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  clinic            Clinic   @relation(fields: [clinicId], references: [id])

  @@index([clinicId, automationType, status])
  @@index([patientId])
  @@index([conversationId])
  @@index([appointmentId])
  @@index([toWhatsappNumber])
}
```

Add this relation field to `model Clinic`:

```prisma
  outboundDeliveries        OutboundDelivery[]
```

Create `prisma/migrations/20260530120000_add_outbound_deliveries/migration.sql`:

```sql
CREATE TABLE "OutboundDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "automationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "toWhatsappNumber" TEXT NOT NULL,
    "patientId" TEXT,
    "conversationId" TEXT,
    "appointmentId" TEXT,
    "templateName" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "claimedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "blockedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutboundDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OutboundDelivery_deliveryKey_key" ON "OutboundDelivery"("deliveryKey");
CREATE INDEX "OutboundDelivery_clinicId_automationType_status_idx" ON "OutboundDelivery"("clinicId", "automationType", "status");
CREATE INDEX "OutboundDelivery_patientId_idx" ON "OutboundDelivery"("patientId");
CREATE INDEX "OutboundDelivery_conversationId_idx" ON "OutboundDelivery"("conversationId");
CREATE INDEX "OutboundDelivery_appointmentId_idx" ON "OutboundDelivery"("appointmentId");
CREATE INDEX "OutboundDelivery_toWhatsappNumber_idx" ON "OutboundDelivery"("toWhatsappNumber");
```

- [ ] **Step 4: Implement Prisma methods**

Modify `src/adapters/prisma/operational-repository.ts`:

1. Import the new types.
2. Add this record type near the other record types:

```ts
type OutboundDeliveryPrismaRecord = {
  id: string;
  clinicId: string;
  deliveryKey: string;
  automationType: string;
  status: string;
  toWhatsappNumber: string;
  patientId: string | null;
  conversationId: string | null;
  appointmentId: string | null;
  templateName: string;
  metadataJson: string;
  providerMessageId: string | null;
  failureReason: string | null;
  claimedAt: Date;
  sentAt: Date | null;
  blockedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

3. Add these methods to `PrismaOperationalRepository`:

```ts
  async listScheduledAppointments(input: ListScheduledAppointmentsInput): Promise<Appointment[]> {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId: input.clinicId,
        status: "scheduled",
        startsAt: { gte: input.from, lte: input.to }
      },
      orderBy: { startsAt: "asc" }
    });
    return appointments.map(toAppointment);
  }

  async listConversationsByClinic(clinicId: Id): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { clinicId },
      orderBy: { updatedAt: "asc" }
    });
    return conversations.map(toConversation);
  }

  async listConversationsByPatient(lookup: ConversationByPatientLookup): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { clinicId: lookup.clinicId, patientId: lookup.patientId },
      orderBy: { updatedAt: "desc" }
    });
    return conversations.map(toConversation);
  }

  async claimOutboundDelivery(input: OutboundDeliveryClaimInput): Promise<OutboundDeliveryClaim> {
    try {
      const delivery = await this.prisma.outboundDelivery.create({
        data: {
          id: `outbound_${randomUUID()}`,
          clinicId: input.clinicId,
          deliveryKey: input.key,
          automationType: input.automationType,
          status: "claimed",
          toWhatsappNumber: input.toWhatsappNumber,
          patientId: input.patientId,
          conversationId: input.conversationId,
          appointmentId: input.appointmentId,
          templateName: input.templateName,
          metadataJson: JSON.stringify(input.metadata),
          claimedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now
        }
      });
      return { kind: "new", delivery: toOutboundDelivery(delivery) };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }
      const existing = await this.prisma.outboundDelivery.findUnique({
        where: { deliveryKey: input.key }
      });
      if (!existing) {
        throw error;
      }
      return { kind: "existing", delivery: toOutboundDelivery(existing) };
    }
  }

  async getOutboundDelivery(key: string): Promise<OutboundDeliveryRecord | undefined> {
    const delivery = await this.prisma.outboundDelivery.findUnique({ where: { deliveryKey: key } });
    return delivery ? toOutboundDelivery(delivery) : undefined;
  }

  async markOutboundDeliverySent(input: {
    key: string;
    providerMessageId: string;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.outboundDelivery.update({
      where: { deliveryKey: input.key },
      data: {
        status: "sent",
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt,
        updatedAt: input.sentAt
      }
    });
  }

  async markOutboundDeliveryBlocked(input: {
    key: string;
    reason: string;
    blockedAt: Date;
  }): Promise<void> {
    await this.prisma.outboundDelivery.update({
      where: { deliveryKey: input.key },
      data: {
        status: "blocked",
        failureReason: input.reason,
        blockedAt: input.blockedAt,
        updatedAt: input.blockedAt
      }
    });
  }

  async markOutboundDeliveryFailed(input: {
    key: string;
    reason: string;
    failedAt: Date;
  }): Promise<void> {
    await this.prisma.outboundDelivery.update({
      where: { deliveryKey: input.key },
      data: {
        status: "failed",
        failureReason: input.reason,
        failedAt: input.failedAt,
        updatedAt: input.failedAt
      }
    });
  }
```

4. Add these conversion helpers near `toWebhookDelivery`:

```ts
function toOutboundDelivery(record: OutboundDeliveryPrismaRecord): OutboundDeliveryRecord {
  return {
    id: record.id,
    key: record.deliveryKey,
    clinicId: record.clinicId,
    automationType: toOutboundAutomationType(record.automationType),
    status: toOutboundDeliveryStatus(record.status),
    toWhatsappNumber: record.toWhatsappNumber,
    ...(record.patientId ? { patientId: record.patientId } : {}),
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(record.appointmentId ? { appointmentId: record.appointmentId } : {}),
    templateName: record.templateName,
    metadata: JSON.parse(record.metadataJson) as Record<string, string>,
    ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {}),
    claimedAt: record.claimedAt,
    ...(record.sentAt ? { sentAt: record.sentAt } : {}),
    ...(record.blockedAt ? { blockedAt: record.blockedAt } : {}),
    ...(record.failedAt ? { failedAt: record.failedAt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toOutboundAutomationType(value: string): OutboundDeliveryRecord["automationType"] {
  if (value === "reminder" || value === "reactivation" || value === "freed_slot") return value;
  throw new Error(`Unknown outbound automation type: ${value}`);
}

function toOutboundDeliveryStatus(value: string): OutboundDeliveryRecord["status"] {
  if (value === "claimed" || value === "sent" || value === "failed" || value === "blocked") return value;
  throw new Error(`Unknown outbound delivery status: ${value}`);
}
```

- [ ] **Step 5: Run focused tests and Prisma validation**

Run:

```bash
npm test -- tests/prisma-operational-repository.test.ts tests/outbound-delivery-repository.test.ts
npx prisma validate
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add prisma/schema.prisma prisma/migrations/20260530120000_add_outbound_deliveries/migration.sql src/adapters/prisma/operational-repository.ts tests/prisma-operational-repository.test.ts
git commit -m "feat: persist outbound deliveries"
```

Expected: commit succeeds.

## Task 3: Add Quiet-Hour And Template Helpers

**Files:**
- Create: `src/application/outbound/quiet-hours.ts`
- Create: `src/application/outbound/templates.ts`
- Create: `tests/outbound-automation-helpers.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/outbound-automation-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isInsideQuietHours } from "../src/application/outbound/quiet-hours.js";
import { buildOutboundTemplate } from "../src/application/outbound/templates.js";

describe("outbound automation helpers", () => {
  it("detects quiet hours in the clinic timezone", () => {
    expect(
      isInsideQuietHours({
        now: new Date("2026-06-01T02:00:00.000Z"),
        timezone: "America/Argentina/Buenos_Aires"
      })
    ).toBe(true);
    expect(
      isInsideQuietHours({
        now: new Date("2026-06-01T15:00:00.000Z"),
        timezone: "America/Argentina/Buenos_Aires"
      })
    ).toBe(false);
  });

  it("builds Momentum-owned template payloads", () => {
    expect(
      buildOutboundTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        kind: "reminder_24h",
        parameters: {
          clinicName: "Clinica Demo",
          serviceName: "Botox",
          appointmentTimeText: "martes 2/6 15:00"
        }
      })
    ).toEqual({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "appointment_reminder_24h",
      languageCode: "es_AR",
      parameters: ["Clinica Demo", "Botox", "martes 2/6 15:00"]
    });

    expect(
      buildOutboundTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        kind: "freed_slot_offer",
        parameters: {
          clinicName: "Clinica Demo",
          serviceName: "Botox",
          appointmentTimeText: "martes 2/6 15:00"
        }
      }).templateName
    ).toBe("freed_slot_offer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-automation-helpers.test.ts
```

Expected: FAIL because helper files do not exist.

- [ ] **Step 3: Implement quiet-hour helper**

Create `src/application/outbound/quiet-hours.ts`:

```ts
export type QuietHoursInput = {
  now: Date;
  timezone: string;
  quietStartHour?: number;
  quietEndHour?: number;
};

export function isInsideQuietHours(input: QuietHoursInput): boolean {
  const quietStartHour = input.quietStartHour ?? 20;
  const quietEndHour = input.quietEndHour ?? 9;
  const hour = localHour(input.now, input.timezone);

  if (quietStartHour === quietEndHour) {
    return false;
  }

  if (quietStartHour > quietEndHour) {
    return hour >= quietStartHour || hour < quietEndHour;
  }

  return hour >= quietStartHour && hour < quietEndHour;
}

function localHour(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false
  });
  return Number(formatter.format(date)) % 24;
}
```

- [ ] **Step 4: Implement template helper**

Create `src/application/outbound/templates.ts`:

```ts
import type { SendTemplateMessageInput } from "../../ports/messaging.js";

export type OutboundTemplateKind =
  | "reminder_72h"
  | "reminder_24h"
  | "reminder_same_day"
  | "reactivation_1"
  | "reactivation_2"
  | "freed_slot_offer";

type CommonTemplateInput = {
  clinicId: string;
  to: string;
  languageCode?: string;
};

type ReminderTemplateInput = CommonTemplateInput & {
  kind: "reminder_72h" | "reminder_24h" | "reminder_same_day" | "freed_slot_offer";
  parameters: {
    clinicName: string;
    serviceName: string;
    appointmentTimeText: string;
  };
};

type ReactivationTemplateInput = CommonTemplateInput & {
  kind: "reactivation_1" | "reactivation_2";
  parameters: {
    clinicName: string;
    serviceName: string;
  };
};

export type BuildOutboundTemplateInput = ReminderTemplateInput | ReactivationTemplateInput;

const templateNames: Record<OutboundTemplateKind, string> = {
  reminder_72h: "appointment_reminder_72h",
  reminder_24h: "appointment_reminder_24h",
  reminder_same_day: "appointment_reminder_same_day",
  reactivation_1: "lead_reactivation_1",
  reactivation_2: "lead_reactivation_2",
  freed_slot_offer: "freed_slot_offer"
};

export function buildOutboundTemplate(input: BuildOutboundTemplateInput): SendTemplateMessageInput {
  const languageCode = input.languageCode ?? "es_AR";
  if (input.kind === "reactivation_1" || input.kind === "reactivation_2") {
    return {
      clinicId: input.clinicId,
      to: input.to,
      templateName: templateNames[input.kind],
      languageCode,
      parameters: [input.parameters.clinicName, input.parameters.serviceName]
    };
  }

  return {
    clinicId: input.clinicId,
    to: input.to,
    templateName: templateNames[input.kind],
    languageCode,
    parameters: [input.parameters.clinicName, input.parameters.serviceName, input.parameters.appointmentTimeText]
  };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/outbound-automation-helpers.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/application/outbound/quiet-hours.ts src/application/outbound/templates.ts tests/outbound-automation-helpers.test.ts
git commit -m "feat: add outbound automation helpers"
```

Expected: commit succeeds.

## Task 4: Implement Reminder Automation

**Files:**
- Create: `src/application/outbound/outbound-automation-service.ts`
- Create: `tests/outbound-automation-reminders.test.ts`

- [ ] **Step 1: Write failing reminder automation tests**

Create `tests/outbound-automation-reminders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../src/application/outbound/outbound-automation-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OutboundAutomationService reminders", () => {
  it("sends a due 24h reminder exactly once", async () => {
    const context = await buildReminderContext();

    const first = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });
    const duplicate = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(first).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(duplicate).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        to: "+5491111111111",
        templateName: "appointment_reminder_24h",
        parameters: ["Clinica Demo", "Botox", expect.stringContaining("03/06")]
      })
    ]);
  });

  it("blocks reminders for opted-out patients and paused conversations", async () => {
    const optedOut = await buildReminderContext({ whatsappNumber: "+5491111112222", appointmentId: "appt_opted" });
    await optedOut.repos.markOptOut("+5491111112222");
    const paused = await buildReminderContext({
      whatsappNumber: "+5491111113333",
      appointmentId: "appt_paused",
      conversationId: "conv_paused",
      botPaused: true
    });

    await expect(
      optedOut.service.runDueReminders({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    await expect(
      paused.service.runDueReminders({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });

    expect(optedOut.provider.sentTemplateMessages).toHaveLength(0);
    expect(paused.provider.sentTemplateMessages).toHaveLength(0);
  });

  it("blocks reminders during quiet hours", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T02:00:00.000Z")
    });

    await expect(
      context.service.runDueReminders({ clinicId: "clinic_1", now: new Date("2026-06-02T02:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toHaveLength(0);
  });

  it("skips reminders when the calendar event is cancelled", async () => {
    const context = await buildReminderContext();
    await context.calendar.cancelEvent("evt_1", "cal_perez");

    await expect(
      context.service.runDueReminders({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toHaveLength(0);
  });

  it("records failed deliveries when WhatsApp sending fails", async () => {
    const context = await buildReminderContext();
    context.provider.failNextSend("kapso unavailable");

    await expect(
      context.service.runDueReminders({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 0, failed: 1, skipped: 0 });

    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({ status: "failed", failureReason: "kapso unavailable" })
    );
  });
});

async function buildReminderContext(options: Partial<{
  appointmentId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  botPaused: boolean;
  appointmentStartsAt: Date;
}> = {}) {
  const repos = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
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
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 3, startTime: "09:00", endTime: "18:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
  const appointmentStartsAt = options.appointmentStartsAt ?? new Date("2026-06-03T12:00:00.000Z");
  const appointmentEndsAt = new Date(appointmentStartsAt.getTime() + 30 * 60000);
  await repos.upsertClinicProfile(profile);
  calendar.seedAvailability("cal_perez", [
    { startsAt: appointmentStartsAt, endsAt: appointmentEndsAt }
  ]);
  await calendar.createEvent({
    calendarId: "cal_perez",
    summary: "Botox - pat_1",
    startsAt: appointmentStartsAt,
    endsAt: appointmentEndsAt,
    metadata: { appointmentId: options.appointmentId ?? "appt_1", patientId: options.patientId ?? "pat_1", serviceId: "svc_botox" }
  });
  await repos.upsertPatient({
    id: options.patientId ?? "pat_1",
    whatsappNumber: options.whatsappNumber ?? "+5491111111111"
  });
  await repos.saveConversation({
    id: options.conversationId ?? "conv_1",
    clinicId: "clinic_1",
    patientId: options.patientId ?? "pat_1",
    botPaused: options.botPaused ?? false,
    createdAt: new Date("2026-05-30T12:00:00.000Z"),
    updatedAt: new Date("2026-05-30T12:00:00.000Z")
  });
  await repos.saveAppointment({
    id: options.appointmentId ?? "appt_1",
    clinicId: "clinic_1",
    patientId: options.patientId ?? "pat_1",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    calendarEventId: "evt_1",
    calendarId: "cal_perez",
    startsAt: appointmentStartsAt,
    endsAt: appointmentEndsAt,
    status: "scheduled"
  });
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });

  return { repos, audit, calendar, provider, service };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-automation-reminders.test.ts
```

Expected: FAIL because `OutboundAutomationService` does not exist.

- [ ] **Step 3: Implement reminder automation service**

Create `src/application/outbound/outbound-automation-service.ts`:

```ts
import type { Appointment, ClinicProfile, Id, Patient, TimeSlot } from "../../domain/types.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { CalendarPort } from "../../ports/calendar.js";
import type { Conversation, OperationalRepository, PatientInterest } from "../../ports/repositories.js";
import type { OutboundTemplateService } from "../messaging/outbound-template-service.js";
import { shouldSendReminder, type ReminderKind } from "./reminder-policy.js";
import { isInsideQuietHours } from "./quiet-hours.js";
import { buildOutboundTemplate } from "./templates.js";

export type OutboundAutomationSummary = {
  sent: number;
  blocked: number;
  failed: number;
  skipped: number;
};

export type OutboundAutomationServiceOptions = {
  repos: OperationalRepository;
  calendar: CalendarPort;
  templateService: OutboundTemplateService;
  audit: AuditLogPort;
};

export class OutboundAutomationService {
  constructor(private readonly options: OutboundAutomationServiceOptions) {}

  async runDueReminders(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    const summary = emptySummary();
    const profile = await this.requireProfile(input.clinicId);
    const appointments = await this.options.repos.listScheduledAppointments({
      clinicId: input.clinicId,
      from: new Date(input.now.getTime()),
      to: new Date(input.now.getTime() + 73 * 60 * 60 * 1000)
    });

    for (const appointment of appointments) {
      const kind = shouldSendReminder({
        now: input.now,
        appointmentTime: appointment.startsAt,
        sameDayRisk: false,
        alreadySent: await this.sentReminderKinds(appointment.id)
      });
      if (kind === "none") {
        continue;
      }

      const key = reminderDeliveryKey(appointment.id, kind);
      const patient = await this.options.repos.getPatient(appointment.patientId);
      if (!patient) {
        summary.blocked += 1;
        await this.auditBlocked({ clinicId: input.clinicId, key, reason: "missing_patient", now: input.now });
        continue;
      }

      const claim = await this.options.repos.claimOutboundDelivery({
        key,
        clinicId: input.clinicId,
        automationType: "reminder",
        toWhatsappNumber: patient.whatsappNumber,
        patientId: patient.id,
        appointmentId: appointment.id,
        templateName: reminderTemplateName(kind),
        metadata: { kind, appointmentStartsAt: appointment.startsAt.toISOString() },
        now: input.now
      });
      if (claim.kind === "existing") {
        summary.skipped += 1;
        continue;
      }

      const blockReason = await this.reminderBlockReason({ profile, appointment, patient, now: input.now });
      if (blockReason) {
        summary.blocked += 1;
        await this.blockDelivery({ clinicId: input.clinicId, key, reason: blockReason, now: input.now });
        continue;
      }

      const service = profile.services.find((candidate) => candidate.id === appointment.serviceId);
      if (!service) {
        summary.blocked += 1;
        await this.blockDelivery({ clinicId: input.clinicId, key, reason: "missing_service", now: input.now });
        continue;
      }

      try {
        const template = buildOutboundTemplate({
          clinicId: input.clinicId,
          to: patient.whatsappNumber,
          kind: reminderTemplateKind(kind),
          parameters: {
            clinicName: profile.name,
            serviceName: service.name,
            appointmentTimeText: formatAppointmentTime(appointment.startsAt, profile.timezone)
          }
        });
        const result = await this.options.templateService.sendApprovedTemplate(template);
        if (result.status === "blocked_opt_out") {
          summary.blocked += 1;
          await this.blockDelivery({ clinicId: input.clinicId, key, reason: "opt_out", now: input.now });
          continue;
        }
        summary.sent += 1;
        await this.options.repos.markOutboundDeliverySent({
          key,
          providerMessageId: result.providerMessageId,
          sentAt: input.now
        });
        await this.options.audit.record({
          clinicId: input.clinicId,
          type: "outbound.reminder.sent",
          message: "Sent appointment reminder",
          metadata: { key, appointmentId: appointment.id, kind }
        });
      } catch (error) {
        summary.failed += 1;
        await this.failDelivery({
          clinicId: input.clinicId,
          key,
          reason: error instanceof Error ? error.message : String(error),
          now: input.now
        });
      }
    }

    return summary;
  }

  private async sentReminderKinds(appointmentId: string): Promise<ReminderKind[]> {
    const kinds: ReminderKind[] = [];
    for (const kind of ["72h", "24h", "same-day"] as const) {
      const delivery = await this.options.repos.getOutboundDelivery(reminderDeliveryKey(appointmentId, kind));
      if (delivery?.status === "sent") {
        kinds.push(kind);
      }
    }
    return kinds;
  }

  private async reminderBlockReason(input: {
    profile: ClinicProfile;
    appointment: Appointment;
    patient: Patient;
    now: Date;
  }): Promise<string | undefined> {
    if (await this.options.repos.isOptedOut(input.patient.whatsappNumber)) {
      return "opt_out";
    }
    if (isInsideQuietHours({ now: input.now, timezone: input.profile.timezone })) {
      return "quiet_hours";
    }
    if (await this.patientHasPausedConversation(input.appointment.clinicId, input.appointment.patientId)) {
      return "handoff_paused";
    }
    const event = await this.options.calendar.getEvent(input.appointment.calendarEventId, input.appointment.calendarId);
    if (!event || event.status === "cancelled") {
      return "calendar_event_cancelled";
    }
    return undefined;
  }

  private async patientHasPausedConversation(clinicId: string, patientId: string): Promise<boolean> {
    const conversations = await this.options.repos.listConversationsByPatient({ clinicId, patientId });
    return conversations.some((conversation) => conversation.botPaused);
  }

  private async requireProfile(clinicId: Id): Promise<ClinicProfile> {
    const profile = await this.options.repos.getClinicProfile(clinicId);
    if (!profile) {
      throw new Error(`Clinic ${clinicId} not configured`);
    }
    return profile;
  }

  private async blockDelivery(input: { clinicId: string; key: string; reason: string; now: Date }) {
    await this.options.repos.markOutboundDeliveryBlocked({
      key: input.key,
      reason: input.reason,
      blockedAt: input.now
    });
    await this.auditBlocked(input);
  }

  private async auditBlocked(input: { clinicId: string; key: string; reason: string; now: Date }) {
    await this.options.audit.record({
      clinicId: input.clinicId,
      type: "outbound.delivery.blocked",
      message: "Blocked outbound delivery",
      metadata: { key: input.key, reason: input.reason }
    });
  }

  private async failDelivery(input: { clinicId: string; key: string; reason: string; now: Date }) {
    await this.options.repos.markOutboundDeliveryFailed({
      key: input.key,
      reason: input.reason,
      failedAt: input.now
    });
    await this.options.audit.record({
      clinicId: input.clinicId,
      type: "outbound.delivery.failed",
      message: "Failed outbound delivery",
      metadata: { key: input.key, reason: input.reason }
    });
  }
}

function emptySummary(): OutboundAutomationSummary {
  return { sent: 0, blocked: 0, failed: 0, skipped: 0 };
}

function reminderDeliveryKey(appointmentId: string, kind: Exclude<ReminderKind, "none">) {
  return `reminder:${appointmentId}:${kind}`;
}

function reminderTemplateName(kind: Exclude<ReminderKind, "none">) {
  if (kind === "72h") return "appointment_reminder_72h";
  if (kind === "24h") return "appointment_reminder_24h";
  return "appointment_reminder_same_day";
}

function reminderTemplateKind(kind: Exclude<ReminderKind, "none">) {
  if (kind === "72h") return "reminder_72h" as const;
  if (kind === "24h") return "reminder_24h" as const;
  return "reminder_same_day" as const;
}

function formatAppointmentTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/outbound-automation-reminders.test.ts tests/outbound-automation-helpers.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/application/outbound/outbound-automation-service.ts tests/outbound-automation-reminders.test.ts
git commit -m "feat: send due appointment reminders"
```

Expected: commit succeeds.

## Task 5: Implement Warm-Lead Reactivation

**Files:**
- Modify: `src/application/outbound/outbound-automation-service.ts`
- Create: `tests/outbound-automation-reactivation.test.ts`

- [ ] **Step 1: Write failing reactivation tests**

Create `tests/outbound-automation-reactivation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../src/application/outbound/outbound-automation-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OutboundAutomationService reactivation", () => {
  it("reactivates an abandoned booking conversation after 24 hours", async () => {
    const context = await buildReactivationContext();

    const result = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(result).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        to: "+5491111111111",
        templateName: "lead_reactivation_1",
        parameters: ["Clinica Demo", "Botox"]
      })
    ]);
  });

  it("does not reactivate generic conversations without pending booking or interest", async () => {
    const context = await buildReactivationContext({ pendingBooking: false });

    await expect(
      context.service.runDueReactivations({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toHaveLength(0);
  });

  it("blocks reactivation for future appointments, opt-out, or handoff pause", async () => {
    const futureAppointment = await buildReactivationContext({ futureAppointment: true });
    const optedOut = await buildReactivationContext({ whatsappNumber: "+5491111112222" });
    await optedOut.repos.markOptOut("+5491111112222");
    const paused = await buildReactivationContext({ botPaused: true });

    await expect(
      futureAppointment.service.runDueReactivations({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    await expect(
      optedOut.service.runDueReactivations({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    await expect(
      paused.service.runDueReactivations({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") })
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
  });

  it("sends a second attempt after seven days and then stops", async () => {
    const context = await buildReactivationContext();
    await context.service.runDueReactivations({ clinicId: "clinic_1", now: new Date("2026-06-02T12:00:00.000Z") });
    await context.service.runDueReactivations({ clinicId: "clinic_1", now: new Date("2026-06-09T12:00:00.000Z") });
    const third = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-16T12:00:00.000Z")
    });

    expect(context.provider.sentTemplateMessages.map((message) => message.templateName)).toEqual([
      "lead_reactivation_1",
      "lead_reactivation_2"
    ]);
    expect(third).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 0 });
  });
});

async function buildReactivationContext(options: Partial<{
  whatsappNumber: string;
  pendingBooking: boolean;
  botPaused: boolean;
  futureAppointment: boolean;
}> = {}) {
  const repos = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
  await repos.upsertClinicProfile(profile());
  await repos.upsertPatient({ id: "pat_1", whatsappNumber: options.whatsappNumber ?? "+5491111111111" });
  await repos.saveConversation({
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: options.botPaused ?? false,
    pendingBooking:
      options.pendingBooking === false
        ? undefined
        : {
            serviceId: "svc_botox",
            professionalId: "pro_perez",
            startsAt: new Date("2026-06-05T12:00:00.000Z"),
            endsAt: new Date("2026-06-05T12:30:00.000Z")
          },
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z")
  });
  if (options.futureAppointment) {
    await repos.saveAppointment({
      id: "appt_future",
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "evt_future",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-05T12:00:00.000Z"),
      endsAt: new Date("2026-06-05T12:30:00.000Z"),
      status: "scheduled"
    });
  }
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });
  return { repos, audit, calendar, provider, service };
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
        workingHours: [{ day: 5, startTime: "09:00", endTime: "18:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-automation-reactivation.test.ts
```

Expected: FAIL because `runDueReactivations` is not implemented.

- [ ] **Step 3: Implement reactivation automation**

Modify `src/application/outbound/outbound-automation-service.ts`:

1. Import `canReactivate`:

```ts
import { canReactivate } from "./reactivation-policy.js";
```

2. Add this public method inside `OutboundAutomationService`:

```ts
  async runDueReactivations(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    const summary = emptySummary();
    const profile = await this.requireProfile(input.clinicId);
    const conversations = await this.options.repos.listConversationsByClinic(input.clinicId);

    for (const conversation of conversations) {
      if (!conversation.pendingBooking) {
        continue;
      }

      const patient = await this.options.repos.getPatient(conversation.patientId);
      if (!patient) {
        summary.blocked += 1;
        await this.auditBlocked({
          clinicId: input.clinicId,
          key: `reactivation:${conversation.id}:missing-patient`,
          reason: "missing_patient",
          now: input.now
        });
        continue;
      }

      const attempt = await this.nextReactivationAttempt(conversation, input.now);
      if (!attempt) {
        continue;
      }

      const key = reactivationDeliveryKey(conversation.id, attempt);
      const service = profile.services.find((candidate) => candidate.id === conversation.pendingBooking?.serviceId);
      if (!service) {
        summary.blocked += 1;
        await this.auditBlocked({ clinicId: input.clinicId, key, reason: "missing_service", now: input.now });
        continue;
      }

      const claim = await this.options.repos.claimOutboundDelivery({
        key,
        clinicId: input.clinicId,
        automationType: "reactivation",
        toWhatsappNumber: patient.whatsappNumber,
        patientId: patient.id,
        conversationId: conversation.id,
        templateName: attempt === 1 ? "lead_reactivation_1" : "lead_reactivation_2",
        metadata: { attempt: String(attempt), serviceId: service.id },
        now: input.now
      });
      if (claim.kind === "existing") {
        summary.skipped += 1;
        continue;
      }

      const blockReason = await this.reactivationBlockReason({ conversation, patient, now: input.now });
      if (blockReason) {
        summary.blocked += 1;
        await this.blockDelivery({ clinicId: input.clinicId, key, reason: blockReason, now: input.now });
        continue;
      }

      try {
        const result = await this.options.templateService.sendApprovedTemplate(
          buildOutboundTemplate({
            clinicId: input.clinicId,
            to: patient.whatsappNumber,
            kind: attempt === 1 ? "reactivation_1" : "reactivation_2",
            parameters: { clinicName: profile.name, serviceName: service.name }
          })
        );
        if (result.status === "blocked_opt_out") {
          summary.blocked += 1;
          await this.blockDelivery({ clinicId: input.clinicId, key, reason: "opt_out", now: input.now });
          continue;
        }
        summary.sent += 1;
        await this.options.repos.markOutboundDeliverySent({
          key,
          providerMessageId: result.providerMessageId,
          sentAt: input.now
        });
        await this.options.audit.record({
          clinicId: input.clinicId,
          conversationId: conversation.id,
          type: "outbound.reactivation.sent",
          message: "Sent lead reactivation",
          metadata: { key, attempt: String(attempt), serviceId: service.id }
        });
      } catch (error) {
        summary.failed += 1;
        await this.failDelivery({
          clinicId: input.clinicId,
          key,
          reason: error instanceof Error ? error.message : String(error),
          now: input.now
        });
      }
    }

    return summary;
  }
```

3. Add these private helpers inside the class:

```ts
  private async nextReactivationAttempt(conversation: Conversation, now: Date): Promise<1 | 2 | undefined> {
    const first = await this.options.repos.getOutboundDelivery(reactivationDeliveryKey(conversation.id, 1));
    const second = await this.options.repos.getOutboundDelivery(reactivationDeliveryKey(conversation.id, 2));
    if (second?.status === "sent" || second?.status === "blocked" || second?.status === "failed") {
      return undefined;
    }
    if (!first) {
      return canReactivate({
        hadPriorConversation: true,
        optedOut: false,
        previousAttempts: 0,
        now,
        lastAttemptAt: conversation.updatedAt
      })
        ? 1
        : undefined;
    }
    if (first.sentAt && conversation.updatedAt > first.sentAt) {
      return undefined;
    }
    if (first.sentAt) {
      return canReactivate({
        hadPriorConversation: true,
        optedOut: false,
        previousAttempts: 1,
        now,
        lastAttemptAt: first.sentAt
      })
        ? 2
        : undefined;
    }
    return undefined;
  }

  private async reactivationBlockReason(input: {
    conversation: Conversation;
    patient: Patient;
    now: Date;
  }): Promise<string | undefined> {
    if (await this.options.repos.isOptedOut(input.patient.whatsappNumber)) {
      return "opt_out";
    }
    if (input.conversation.botPaused) {
      return "handoff_paused";
    }
    const appointments = await this.options.repos.listAppointmentsByPatient(input.patient.id);
    const hasFutureScheduledAppointment = appointments.some(
      (appointment) => appointment.status === "scheduled" && appointment.startsAt > input.now
    );
    if (hasFutureScheduledAppointment) {
      return "future_appointment";
    }
    return undefined;
  }
```

4. Add this helper after `reminderDeliveryKey`:

```ts
function reactivationDeliveryKey(conversationId: string, attempt: 1 | 2) {
  return `reactivation:${conversationId}:${attempt}`;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/outbound-automation-reactivation.test.ts tests/outbound-automation-reminders.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/application/outbound/outbound-automation-service.ts tests/outbound-automation-reactivation.test.ts
git commit -m "feat: reactivate warm abandoned bookings"
```

Expected: commit succeeds.

## Task 6: Implement Freed-Slot Offers And Scheduling Trigger

**Files:**
- Modify: `src/application/outbound/outbound-automation-service.ts`
- Modify: `src/application/scheduling/scheduling-service.ts`
- Create: `tests/outbound-automation-freed-slot.test.ts`

- [ ] **Step 1: Write failing freed-slot tests**

Create `tests/outbound-automation-freed-slot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../src/application/outbound/outbound-automation-service.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OutboundAutomationService freed-slot offers", () => {
  it("offers a freed slot to the best matching active interest once", async () => {
    const context = await buildFreedSlotContext();

    const first = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      now: new Date("2026-06-04T12:00:00.000Z")
    });
    const duplicate = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      now: new Date("2026-06-04T12:00:00.000Z")
    });

    expect(first).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(duplicate).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        to: "+5491111111111",
        templateName: "freed_slot_offer",
        parameters: ["Clinica Demo", "Botox", expect.stringContaining("05/06")]
      })
    ]);
  });

  it("does not offer freed slots to opted-out or paused patients", async () => {
    const optedOut = await buildFreedSlotContext({ whatsappNumber: "+5491111112222" });
    await optedOut.repos.markOptOut("+5491111112222");
    const paused = await buildFreedSlotContext({ botPaused: true });

    await expect(
      optedOut.service.handleFreedSlot(freedSlotInput())
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    await expect(
      paused.service.handleFreedSlot(freedSlotInput())
    ).resolves.toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
  });

  it("triggers freed-slot handling after a successful cancellation", async () => {
    const context = await buildFreedSlotContext();
    let calledWith: unknown;
    const scheduling = new SchedulingService(
      context.repos,
      context.calendar,
      context.audit,
      () => new Date("2026-06-01T12:00:00.000Z"),
      {
        handleFreedSlot: async (input) => {
          calledWith = input;
        }
      }
    );

    await context.calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Botox - pat_cancelled",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      endsAt: new Date("2026-06-05T13:30:00.000Z"),
      metadata: { appointmentId: "appt_cancelled", patientId: "pat_cancelled", serviceId: "svc_botox" }
    });
    await context.repos.upsertPatient({ id: "pat_cancelled", whatsappNumber: "+5491111119999" });
    await context.repos.saveAppointment({
      id: "appt_cancelled",
      clinicId: "clinic_1",
      patientId: "pat_cancelled",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "evt_1",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      endsAt: new Date("2026-06-05T13:30:00.000Z"),
      status: "scheduled"
    });

    await scheduling.cancelAppointment({ clinicId: "clinic_1", appointmentId: "appt_cancelled" });

    expect(calledWith).toEqual({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      }
    });
  });
});

function freedSlotInput() {
  return {
    clinicId: "clinic_1",
    serviceId: "svc_botox",
    sourceAppointmentId: "appt_cancelled",
    slot: {
      professionalId: "pro_perez",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      endsAt: new Date("2026-06-05T13:30:00.000Z")
    },
    now: new Date("2026-06-04T12:00:00.000Z")
  };
}

async function buildFreedSlotContext(options: Partial<{ whatsappNumber: string; botPaused: boolean }> = {}) {
  const repos = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
  await repos.upsertClinicProfile(profile());
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-05T13:00:00.000Z"), endsAt: new Date("2026-06-05T13:30:00.000Z") },
    { startsAt: new Date("2026-06-06T13:00:00.000Z"), endsAt: new Date("2026-06-06T13:30:00.000Z") }
  ]);
  await repos.upsertPatient({ id: "pat_1", whatsappNumber: options.whatsappNumber ?? "+5491111111111" });
  await repos.saveConversation({
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: options.botPaused ?? false,
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T12:00:00.000Z")
  });
  await repos.saveInterest({
    id: "interest_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
    preferredTo: new Date("2026-06-05T16:00:00.000Z"),
    status: "active"
  });
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });
  return { repos, audit, calendar, provider, service };
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
        workingHours: [{ day: 5, startTime: "09:00", endTime: "18:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-automation-freed-slot.test.ts
```

Expected: FAIL because `handleFreedSlot` and the scheduling constructor option do not exist.

- [ ] **Step 3: Add freed-slot handler contract to scheduling**

Modify `src/application/scheduling/scheduling-service.ts`:

1. Import `TimeSlot`:

```ts
import type { Appointment, ClinicProfile, TimeSlot } from "../../domain/types.js";
```

2. Add this type near `BookAppointmentInput`:

```ts
export type FreedSlotHandler = {
  handleFreedSlot(input: {
    clinicId: string;
    serviceId: string;
    sourceAppointmentId: string;
    slot: TimeSlot;
  }): Promise<void>;
};
```

3. Update the constructor:

```ts
  constructor(
    private readonly repos: OperationalRepository,
    private readonly calendar: CalendarPort,
    private readonly audit: AuditLogPort,
    private readonly now: () => Date = () => new Date(),
    private readonly freedSlotHandler?: FreedSlotHandler
  ) {}
```

4. After the cancellation audit record in `cancelAppointment`, add:

```ts
      await this.notifyFreedSlot({
        clinicId: input.clinicId,
        serviceId: appointment.serviceId,
        sourceAppointmentId: appointment.id,
        slot: appointmentToSlot(appointment)
      });
```

5. After the reschedule audit record in `rescheduleAppointment`, add:

```ts
      await this.notifyFreedSlot({
        clinicId: input.clinicId,
        serviceId: appointment.serviceId,
        sourceAppointmentId: appointment.id,
        slot: appointmentToSlot(appointment)
      });
```

6. Add this private method inside the class:

```ts
  private async notifyFreedSlot(input: Parameters<FreedSlotHandler["handleFreedSlot"]>[0]) {
    if (!this.freedSlotHandler) {
      return;
    }
    try {
      await this.freedSlotHandler.handleFreedSlot(input);
    } catch (error) {
      await this.audit.record({
        clinicId: input.clinicId,
        type: "outbound.freed_slot.failed",
        message: "Failed to handle freed appointment slot",
        metadata: {
          appointmentId: input.sourceAppointmentId,
          serviceId: input.serviceId,
          reason: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
```

7. Add this helper near `addMinutes`:

```ts
function appointmentToSlot(appointment: Appointment): TimeSlot {
  return {
    professionalId: appointment.professionalId,
    calendarId: appointment.calendarId,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt
  };
}
```

- [ ] **Step 4: Implement freed-slot automation**

Modify `src/application/outbound/outbound-automation-service.ts`:

1. Import `matchFreedSlot`:

```ts
import { matchFreedSlot } from "./freed-slot-service.js";
```

2. Add this method inside `OutboundAutomationService`:

```ts
  async handleFreedSlot(input: {
    clinicId: string;
    serviceId: string;
    sourceAppointmentId: string;
    slot: TimeSlot;
    now: Date;
  }): Promise<OutboundAutomationSummary> {
    const summary = emptySummary();
    const profile = await this.requireProfile(input.clinicId);
    const interests = await this.options.repos.listActiveInterests();
    const match = matchFreedSlot({
      clinicId: input.clinicId,
      serviceId: input.serviceId,
      slot: input.slot,
      interests
    });
    if (!match) {
      return summary;
    }

    const patient = await this.options.repos.getPatient(match.patientId);
    const service = profile.services.find((candidate) => candidate.id === input.serviceId);
    if (!patient || !service) {
      summary.blocked += 1;
      await this.auditBlocked({
        clinicId: input.clinicId,
        key: freedSlotDeliveryKey(input.sourceAppointmentId, match, input.slot),
        reason: patient ? "missing_service" : "missing_patient",
        now: input.now
      });
      return summary;
    }

    const key = freedSlotDeliveryKey(input.sourceAppointmentId, match, input.slot);
    const claim = await this.options.repos.claimOutboundDelivery({
      key,
      clinicId: input.clinicId,
      automationType: "freed_slot",
      toWhatsappNumber: patient.whatsappNumber,
      patientId: patient.id,
      templateName: "freed_slot_offer",
      metadata: {
        interestId: match.id,
        serviceId: input.serviceId,
        sourceAppointmentId: input.sourceAppointmentId,
        slotStartsAt: input.slot.startsAt.toISOString()
      },
      now: input.now
    });
    if (claim.kind === "existing") {
      summary.skipped += 1;
      return summary;
    }

    const blockReason = await this.freedSlotBlockReason({ profile, patient, match, now: input.now });
    if (blockReason) {
      summary.blocked += 1;
      await this.blockDelivery({ clinicId: input.clinicId, key, reason: blockReason, now: input.now });
      return summary;
    }

    try {
      const result = await this.options.templateService.sendApprovedTemplate(
        buildOutboundTemplate({
          clinicId: input.clinicId,
          to: patient.whatsappNumber,
          kind: "freed_slot_offer",
          parameters: {
            clinicName: profile.name,
            serviceName: service.name,
            appointmentTimeText: formatAppointmentTime(input.slot.startsAt, profile.timezone)
          }
        })
      );
      if (result.status === "blocked_opt_out") {
        summary.blocked += 1;
        await this.blockDelivery({ clinicId: input.clinicId, key, reason: "opt_out", now: input.now });
        return summary;
      }
      summary.sent += 1;
      await this.options.repos.markOutboundDeliverySent({
        key,
        providerMessageId: result.providerMessageId,
        sentAt: input.now
      });
      await this.options.audit.record({
        clinicId: input.clinicId,
        type: "outbound.freed_slot.sent",
        message: "Sent freed-slot offer",
        metadata: { key, interestId: match.id, sourceAppointmentId: input.sourceAppointmentId }
      });
    } catch (error) {
      summary.failed += 1;
      await this.failDelivery({
        clinicId: input.clinicId,
        key,
        reason: error instanceof Error ? error.message : String(error),
        now: input.now
      });
    }

    return summary;
  }
```

3. Add this private helper inside the class:

```ts
  private async freedSlotBlockReason(input: {
    profile: ClinicProfile;
    patient: Patient;
    match: PatientInterest;
    now: Date;
  }): Promise<string | undefined> {
    if (await this.options.repos.isOptedOut(input.patient.whatsappNumber)) {
      return "opt_out";
    }
    if (isInsideQuietHours({ now: input.now, timezone: input.profile.timezone })) {
      return "quiet_hours";
    }
    if (await this.patientHasPausedConversation(input.match.clinicId, input.match.patientId)) {
      return "handoff_paused";
    }
    return undefined;
  }
```

4. Add this helper after `reactivationDeliveryKey`:

```ts
function freedSlotDeliveryKey(sourceAppointmentId: string, interest: PatientInterest, slot: TimeSlot) {
  return `freed-slot:${sourceAppointmentId}:${interest.id}:${slot.startsAt.toISOString()}`;
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/outbound-automation-freed-slot.test.ts tests/scheduling-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/application/outbound/outbound-automation-service.ts src/application/scheduling/scheduling-service.ts tests/outbound-automation-freed-slot.test.ts
git commit -m "feat: offer freed appointment slots"
```

Expected: commit succeeds.

## Task 7: Wire Runtime And Internal Run Route

**Files:**
- Create: `src/config/outbound.ts`
- Create: `src/api/outbound-routes.ts`
- Modify: `src/api/app.ts`
- Modify: `src/runtime/server-runtime.ts`
- Modify: `src/server.ts`
- Create: `tests/outbound-routes.test.ts`
- Modify: `tests/server-runtime.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/outbound-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { OutboundAutomationSummary } from "../src/application/outbound/outbound-automation-service.js";

describe("outbound internal routes", () => {
  it("rejects outbound runs without the internal token", async () => {
    const app = buildApp({
      outboundAutomation: {
        token: "secret",
        service: new FakeOutboundAutomation()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      payload: { clinicId: "clinic_1" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("runs reminders and reactivations when authorized", async () => {
    const service = new FakeOutboundAutomation();
    const app = buildApp({
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reminders: { sent: 1, blocked: 0, failed: 0, skipped: 0 },
      reactivations: { sent: 2, blocked: 0, failed: 0, skipped: 0 }
    });
    expect(service.calls).toEqual([
      "reminders:clinic_1:2026-06-02T12:00:00.000Z",
      "reactivations:clinic_1:2026-06-02T12:00:00.000Z"
    ]);
  });
});

class FakeOutboundAutomation {
  readonly calls: string[] = [];

  async runDueReminders(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reminders:${input.clinicId}:${input.now.toISOString()}`);
    return { sent: 1, blocked: 0, failed: 0, skipped: 0 };
  }

  async runDueReactivations(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reactivations:${input.clinicId}:${input.now.toISOString()}`);
    return { sent: 2, blocked: 0, failed: 0, skipped: 0 };
  }
}
```

Append this test inside the existing `describe("server runtime persistence wiring", () => { ... })` block in `tests/server-runtime.test.ts`:

```ts
  it("exposes outbound automation for Kapso runtime", async () => {
    const runtime = await buildWhatsAppRuntime({
      prisma,
      clinicId: "clinic_runtime_outbound",
      config: {
        provider: "kapso",
        apiKey: "kapso_api_key",
        webhookSecret: "kapso_webhook_secret",
        phoneNumberId: "123456789012347"
      },
      calendarProvider: "fake",
      aiConfig: { provider: "rules" }
    });

    expect(runtime.outboundAutomation).toEqual(
      expect.objectContaining({
        runDueReminders: expect.any(Function),
        runDueReactivations: expect.any(Function),
        handleFreedSlot: expect.any(Function)
      })
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-routes.test.ts
```

Expected: FAIL because outbound route options do not exist.

- [ ] **Step 3: Add outbound config**

Create `src/config/outbound.ts`:

```ts
export type OutboundConfig =
  | { enabled: false }
  | { enabled: true; token: string };

export function readOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  const token = env.OUTBOUND_AUTOMATION_TOKEN;
  if (!token) {
    return { enabled: false };
  }
  return { enabled: true, token };
}
```

- [ ] **Step 4: Add internal route**

Create `src/api/outbound-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OutboundAutomationService } from "../application/outbound/outbound-automation-service.js";

export type OutboundAutomationRoutesOptions = {
  token: string;
  service: Pick<OutboundAutomationService, "runDueReminders" | "runDueReactivations">;
};

const runSchema = z.object({
  clinicId: z.string().min(1),
  now: z.coerce.date().optional(),
  reminders: z.boolean().optional(),
  reactivations: z.boolean().optional()
});

export function registerOutboundRoutes(app: FastifyInstance, options: OutboundAutomationRoutesOptions) {
  app.post("/internal/outbound/run", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_outbound_run" });
    }

    const now = parsed.data.now ?? new Date();
    const runReminders = parsed.data.reminders ?? true;
    const runReactivations = parsed.data.reactivations ?? true;

    const reminders = runReminders
      ? await options.service.runDueReminders({ clinicId: parsed.data.clinicId, now })
      : { sent: 0, blocked: 0, failed: 0, skipped: 0 };
    const reactivations = runReactivations
      ? await options.service.runDueReactivations({ clinicId: parsed.data.clinicId, now })
      : { sent: 0, blocked: 0, failed: 0, skipped: 0 };

    return reply.send({ reminders, reactivations });
  });
}
```

- [ ] **Step 5: Register route in app factory**

Modify `src/api/app.ts`:

1. Import:

```ts
import { registerOutboundRoutes, type OutboundAutomationRoutesOptions } from "./outbound-routes.js";
```

2. Add to `BuildAppOptions`:

```ts
  outboundAutomation?: OutboundAutomationRoutesOptions;
```

3. Add before `return app;`:

```ts
  if (options.outboundAutomation) {
    registerOutboundRoutes(app, options.outboundAutomation);
  }
```

- [ ] **Step 6: Wire runtime**

Modify `src/runtime/server-runtime.ts`:

1. Import:

```ts
import { OutboundTemplateService } from "../application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../application/outbound/outbound-automation-service.js";
```

2. In `buildWhatsAppRuntime`, create the provider before scheduling, then create template/outbound services:

```ts
  const provider = new KapsoWhatsAppProvider({
    apiKey: input.config.apiKey,
    phoneNumberId: input.config.phoneNumberId
  });
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const outboundAutomation = new OutboundAutomationService({
    repos,
    calendar: input.calendar ?? buildDefaultCalendar(input.calendarProvider),
    templateService,
    audit
  });
```

3. Pass the same calendar instance to both `SchedulingService` and `OutboundAutomationService`. Do this by assigning it first:

```ts
  const calendar = input.calendar ?? buildDefaultCalendar(input.calendarProvider);
```

4. Construct scheduling with the freed-slot handler:

```ts
  const scheduling = new SchedulingService(repos, calendar, audit, () => new Date(), {
    handleFreedSlot: async (freedSlot) => {
      await outboundAutomation.handleFreedSlot({ ...freedSlot, now: new Date() });
    }
  });
```

5. Return `outboundAutomation` next to `webhook`:

```ts
    outboundAutomation,
```

- [ ] **Step 7: Wire server route**

Modify `src/server.ts`:

1. Import outbound config:

```ts
import { readOutboundConfig } from "./config/outbound.js";
```

2. Read config near WhatsApp config:

```ts
const outboundConfig = readOutboundConfig(process.env);
```

3. Add to `buildApp` options:

```ts
  outboundAutomation:
    outboundConfig.enabled && whatsappRuntime
      ? { token: outboundConfig.token, service: whatsappRuntime.outboundAutomation }
      : undefined
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm test -- tests/outbound-routes.test.ts tests/server-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/config/outbound.ts src/api/outbound-routes.ts src/api/app.ts src/runtime/server-runtime.ts src/server.ts tests/outbound-routes.test.ts tests/server-runtime.test.ts
git commit -m "feat: wire outbound automation runtime"
```

Expected: commit succeeds.

## Task 8: Document And Verify The Complete Block

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add this section after "Kapso WhatsApp Local Setup":

```md
## Outbound Automation Local Run

Outbound automation sends approved WhatsApp templates for:

- appointment reminders;
- warm abandoned-booking reactivation;
- freed-slot offers after cancellation or reschedule.

Set an internal token to enable the cron/manual route:

```bash
OUTBOUND_AUTOMATION_TOKEN="local-outbound-token"
```

Run due reminders and reactivations:

```bash
curl -sS -X POST http://127.0.0.1:3000/internal/outbound/run \
  -H 'authorization: Bearer local-outbound-token' \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1"}'
```

For deterministic local testing, pass `now`:

```bash
curl -sS -X POST http://127.0.0.1:3000/internal/outbound/run \
  -H 'authorization: Bearer local-outbound-token' \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","now":"2026-06-02T12:00:00.000Z"}'
```

Every outbound send is guarded by opt-out state, handoff pause, quiet hours, durable delivery keys, and audit logging.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test -- --run
npx prisma validate
```

Expected:
- typecheck exits with code 0;
- Vitest reports all test files passing;
- Prisma reports `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 3: Commit docs**

Run:

```bash
git add README.md
git commit -m "docs: document outbound automation"
```

Expected: commit succeeds.

## Self-Review Checklist

- Spec coverage:
  - Reminder automation: Tasks 3, 4, 7, 8.
  - Reactivation: Tasks 3, 5, 7, 8.
  - Freed slots: Tasks 3, 6, 8.
  - Opt-out, handoff pause, quiet hours: Tasks 3, 4, 5, 6.
  - Idempotency and persistence: Tasks 1, 2, 4, 5, 6.
  - Runtime execution: Task 7.
  - Auditability: Tasks 4, 5, 6.
- No customer dashboard, campaign builder, cold outreach, payment flow, Outlook-specific changes, or internal staff agent are included.
- The implementation remains deterministic; no model-triggered outbound campaigns are added.
- Full verification is required in Task 8 before completion.
