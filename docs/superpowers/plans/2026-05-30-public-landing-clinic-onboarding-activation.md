# Public Landing + Clinic Onboarding & Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a premium Momentum landing page plus a real private clinic onboarding and activation flow that supports assisted sales, lead capture, setup, testing, and production gating.

**Architecture:** Add durable onboarding/activation state next to the existing operational data model, expose public lead capture and token-protected internal onboarding APIs from the current Fastify backend, then add a compact Next.js App Router web app under `apps/web`. Production WhatsApp and outbound automation must fail closed for inactive clinics, while internal test mode can exercise setup/ready clinics before launch.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Prisma SQLite, Vitest, Next.js App Router, React, CSS modules or global CSS, lucide-react icons.

---

## Scope Check

This plan implements:

- public landing page;
- qualified lead capture;
- private onboarding API and UI;
- clinic activation states and payment status;
- operational clinic setup persistence;
- test-mode conversation endpoint;
- production activation gates for WhatsApp and outbound automation;
- local docs and verification.

This plan does not implement:

- automated checkout or subscriptions;
- customer-facing dashboard;
- full self-serve WhatsApp onboarding;
- multi-location onboarding;
- staff/internal WhatsApp agent;
- analytics dashboard beyond readiness/status fields.

## File Structure

Backend/domain:

- `src/ports/onboarding.ts`: onboarding repository contract and setup/activation types.
- `src/adapters/memory/onboarding-repository.ts`: in-memory onboarding repository for tests.
- `src/adapters/prisma/onboarding-repository.ts`: Prisma onboarding repository.
- `src/application/onboarding/onboarding-service.ts`: lead submission, clinic setup state, readiness checks, payment status, activation/pause.
- `src/application/onboarding/test-mode-service.ts`: scoped internal conversation test mode.
- `src/config/admin.ts`: internal admin token config.
- `src/api/onboarding-routes.ts`: public lead and private onboarding/test routes.
- `src/api/app.ts`: register onboarding routes.
- `src/api/whatsapp-routes.ts`: production active-clinic gate.
- `src/api/outbound-routes.ts`: internal route active-clinic gate.
- `src/application/outbound/outbound-automation-service.ts`: direct outbound service active-clinic gate.
- `src/runtime/server-runtime.ts`: create Prisma onboarding repository and pass guards/services.
- `src/server.ts`: wire onboarding routes, admin token, activation checks.

Database:

- `prisma/schema.prisma`: add onboarding fields and models.
- `prisma/migrations/20260530150000_add_clinic_onboarding/migration.sql`: migration.

Frontend:

- `package.json`: npm workspaces and web scripts.
- `tsconfig.json`: keep backend compile scope; web has separate tsconfig.
- `apps/web/package.json`: Next app package.
- `apps/web/next.config.mjs`: Next config.
- `apps/web/tsconfig.json`: web TypeScript config.
- `apps/web/src/app/layout.tsx`: app shell metadata.
- `apps/web/src/app/page.tsx`: premium landing.
- `apps/web/src/app/lead/page.tsx`: lead form and success state.
- `apps/web/src/app/internal/onboarding/page.tsx`: private lead/clinic overview.
- `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`: setup wizard.
- `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`: test mode UI.
- `apps/web/src/app/internal/onboarding/clinics/[clinicId]/activation/page.tsx`: checklist and activation controls.
- `apps/web/src/app/globals.css`: premium visual system and responsive layout.
- `apps/web/src/lib/api.ts`: backend API client.
- `apps/web/src/lib/types.ts`: web DTO types matching backend API.

Tests:

- `tests/onboarding-repository.test.ts`
- `tests/onboarding-service.test.ts`
- `tests/onboarding-routes.test.ts`
- `tests/activation-gates.test.ts`
- `tests/onboarding-test-mode.test.ts`
- `tests/prisma-onboarding-repository.test.ts`

Docs:

- `README.md`: local landing/onboarding instructions.
- `.env.example`: admin token, API URL, web URL notes.

## Task 1: Add Onboarding Repository Contract And Memory Adapter

**Files:**
- Create: `src/ports/onboarding.ts`
- Create: `src/adapters/memory/onboarding-repository.ts`
- Create: `tests/onboarding-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/onboarding-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";

describe("onboarding repository contract", () => {
  it("creates qualified landing leads and lists newest first", async () => {
    const repo = new InMemoryOnboardingRepository();

    const first = await repo.createLead({
      contactName: "Ana Manager",
      clinicName: "Clinica Norte",
      whatsappOrPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      professionalCount: 3,
      currentSchedulingSystem: "Google Calendar",
      monthlyWhatsappInquiries: "200-500",
      mainPain: "missed_leads",
      source: "landing",
      submittedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    const second = await repo.createLead({
      contactName: "Bruno Owner",
      clinicName: "Derma Sur",
      whatsappOrPhone: "+5491122222222",
      city: "Cordoba",
      country: "Argentina",
      professionalCount: 1,
      currentSchedulingSystem: "Outlook",
      monthlyWhatsappInquiries: "50-200",
      mainPain: "reception_load",
      source: "landing",
      submittedAt: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(first.id).toMatch(/^lead_/);
    await expect(repo.listLeads()).resolves.toEqual([
      expect.objectContaining({ id: second.id, clinicName: "Derma Sur", status: "lead" }),
      expect.objectContaining({ id: first.id, clinicName: "Clinica Norte", status: "lead" })
    ]);
  });

  it("stores clinic setup state, payment status, readiness flags, and knowledge", async () => {
    const repo = new InMemoryOnboardingRepository();
    await repo.upsertClinicSetup({
      clinicId: "clinic_1",
      source: "presencial",
      lifecycleState: "setup",
      paymentStatus: "unpaid",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      whatsappReady: false,
      calendarConnected: false,
      testConversationPassed: false,
      activationChecklistCompleted: false,
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_payment",
      clinicId: "clinic_1",
      category: "payment_methods",
      question: "Como se puede pagar?",
      answer: "Aceptamos transferencia, efectivo y tarjeta.",
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });

    await repo.updateClinicLifecycle({
      clinicId: "clinic_1",
      lifecycleState: "ready",
      paymentStatus: "paid",
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });
    await repo.updateReadinessFlags({
      clinicId: "clinic_1",
      calendarConnected: true,
      whatsappReady: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(repo.getClinicSetup("clinic_1")).resolves.toEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        source: "presencial",
        lifecycleState: "ready",
        paymentStatus: "paid",
        calendarConnected: true,
        whatsappReady: true,
        testConversationPassed: true,
        activationChecklistCompleted: true
      })
    );
    await expect(repo.isClinicActive("clinic_1")).resolves.toBe(false);
    await repo.updateClinicLifecycle({
      clinicId: "clinic_1",
      lifecycleState: "active",
      updatedAt: new Date("2026-06-01T12:04:00.000Z")
    });
    await expect(repo.isClinicActive("clinic_1")).resolves.toBe(true);
    await expect(repo.listClinicKnowledge("clinic_1")).resolves.toEqual([
      expect.objectContaining({
        id: "knowledge_payment",
        category: "payment_methods",
        answer: "Aceptamos transferencia, efectivo y tarjeta."
      })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/onboarding-repository.test.ts
```

Expected: FAIL because `src/ports/onboarding.ts` and `InMemoryOnboardingRepository` do not exist.

- [ ] **Step 3: Add onboarding repository port**

Create `src/ports/onboarding.ts`:

```ts
import type { Id } from "../domain/types.js";
import type { MaybePromise } from "./repositories.js";

export type ClinicLeadSource = "landing" | "presencial" | "referido" | "outbound";
export type ClinicLeadStatus = "lead" | "converted" | "archived";
export type ClinicLifecycleState = "lead" | "setup" | "ready" | "active" | "paused";
export type ClinicPaymentStatus = "unpaid" | "paid" | "trial" | "waived";

export type ClinicMainPain =
  | "missed_leads"
  | "reception_load"
  | "reactivation"
  | "no_shows"
  | "rescheduling"
  | "other";

export type ClinicLeadInput = {
  contactName: string;
  clinicName: string;
  whatsappOrPhone: string;
  city: string;
  country: string;
  professionalCount: number;
  currentSchedulingSystem: string;
  monthlyWhatsappInquiries: string;
  mainPain: ClinicMainPain;
  source: ClinicLeadSource;
  submittedAt: Date;
};

export type ClinicLeadRecord = ClinicLeadInput & {
  id: Id;
  status: ClinicLeadStatus;
  convertedClinicId?: Id;
  createdAt: Date;
  updatedAt: Date;
};

export type ClinicSetupRecord = {
  clinicId: Id;
  leadId?: Id;
  source: ClinicLeadSource;
  lifecycleState: ClinicLifecycleState;
  paymentStatus: ClinicPaymentStatus;
  primaryContactName: string;
  primaryContactPhone: string;
  city: string;
  country: string;
  whatsappReady: boolean;
  calendarConnected: boolean;
  testConversationPassed: boolean;
  activationChecklistCompleted: boolean;
  createdAt?: Date;
  updatedAt: Date;
};

export type ClinicKnowledgeCategory =
  | "payment_methods"
  | "insurance"
  | "address"
  | "parking"
  | "policy"
  | "other";

export type ClinicKnowledgeRecord = {
  id: Id;
  clinicId: Id;
  category: ClinicKnowledgeCategory;
  question: string;
  answer: string;
  updatedAt: Date;
};

export type ClinicReadiness = {
  clinicId: Id;
  ready: boolean;
  missing: string[];
};

export interface OnboardingRepository {
  createLead(input: ClinicLeadInput): MaybePromise<ClinicLeadRecord>;
  listLeads(): MaybePromise<ClinicLeadRecord[]>;
  getLead(leadId: Id): MaybePromise<ClinicLeadRecord | undefined>;
  markLeadConverted(input: { leadId: Id; clinicId: Id; updatedAt: Date }): MaybePromise<void>;
  upsertClinicSetup(input: ClinicSetupRecord): MaybePromise<ClinicSetupRecord>;
  getClinicSetup(clinicId: Id): MaybePromise<ClinicSetupRecord | undefined>;
  listClinicSetups(): MaybePromise<ClinicSetupRecord[]>;
  updateClinicLifecycle(input: {
    clinicId: Id;
    lifecycleState: ClinicLifecycleState;
    paymentStatus?: ClinicPaymentStatus;
    updatedAt: Date;
  }): MaybePromise<void>;
  updateReadinessFlags(input: {
    clinicId: Id;
    whatsappReady?: boolean;
    calendarConnected?: boolean;
    testConversationPassed?: boolean;
    activationChecklistCompleted?: boolean;
    updatedAt: Date;
  }): MaybePromise<void>;
  upsertClinicKnowledge(input: ClinicKnowledgeRecord): MaybePromise<void>;
  listClinicKnowledge(clinicId: Id): MaybePromise<ClinicKnowledgeRecord[]>;
  isClinicActive(clinicId: Id): MaybePromise<boolean>;
}
```

- [ ] **Step 4: Add memory adapter**

Create `src/adapters/memory/onboarding-repository.ts`:

```ts
import type {
  ClinicKnowledgeRecord,
  ClinicLeadInput,
  ClinicLeadRecord,
  ClinicSetupRecord,
  OnboardingRepository
} from "../../ports/onboarding.js";
import type { Id } from "../../domain/types.js";

export class InMemoryOnboardingRepository implements OnboardingRepository {
  private leads = new Map<Id, ClinicLeadRecord>();
  private setups = new Map<Id, ClinicSetupRecord>();
  private knowledge = new Map<Id, ClinicKnowledgeRecord>();
  private leadCounter = 0;

  createLead(input: ClinicLeadInput): ClinicLeadRecord {
    this.leadCounter += 1;
    const now = new Date(input.submittedAt);
    const lead: ClinicLeadRecord = {
      ...input,
      id: `lead_${this.leadCounter}`,
      status: "lead",
      submittedAt: new Date(input.submittedAt),
      createdAt: now,
      updatedAt: now
    };
    this.leads.set(lead.id, cloneLead(lead));
    return cloneLead(lead);
  }

  listLeads(): ClinicLeadRecord[] {
    return [...this.leads.values()]
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map(cloneLead);
  }

  getLead(leadId: Id): ClinicLeadRecord | undefined {
    const lead = this.leads.get(leadId);
    return lead ? cloneLead(lead) : undefined;
  }

  markLeadConverted(input: { leadId: Id; clinicId: Id; updatedAt: Date }) {
    const lead = this.requireLead(input.leadId);
    this.leads.set(input.leadId, {
      ...lead,
      status: "converted",
      convertedClinicId: input.clinicId,
      updatedAt: new Date(input.updatedAt)
    });
  }

  upsertClinicSetup(input: ClinicSetupRecord): ClinicSetupRecord {
    const existing = this.setups.get(input.clinicId);
    const setup: ClinicSetupRecord = {
      ...input,
      createdAt: existing?.createdAt ?? new Date(input.updatedAt),
      updatedAt: new Date(input.updatedAt)
    };
    this.setups.set(input.clinicId, cloneSetup(setup));
    return cloneSetup(setup);
  }

  getClinicSetup(clinicId: Id): ClinicSetupRecord | undefined {
    const setup = this.setups.get(clinicId);
    return setup ? cloneSetup(setup) : undefined;
  }

  listClinicSetups(): ClinicSetupRecord[] {
    return [...this.setups.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneSetup);
  }

  updateClinicLifecycle(input: {
    clinicId: Id;
    lifecycleState: ClinicSetupRecord["lifecycleState"];
    paymentStatus?: ClinicSetupRecord["paymentStatus"];
    updatedAt: Date;
  }) {
    const setup = this.requireSetup(input.clinicId);
    this.setups.set(input.clinicId, {
      ...setup,
      lifecycleState: input.lifecycleState,
      paymentStatus: input.paymentStatus ?? setup.paymentStatus,
      updatedAt: new Date(input.updatedAt)
    });
  }

  updateReadinessFlags(input: {
    clinicId: Id;
    whatsappReady?: boolean;
    calendarConnected?: boolean;
    testConversationPassed?: boolean;
    activationChecklistCompleted?: boolean;
    updatedAt: Date;
  }) {
    const setup = this.requireSetup(input.clinicId);
    this.setups.set(input.clinicId, {
      ...setup,
      whatsappReady: input.whatsappReady ?? setup.whatsappReady,
      calendarConnected: input.calendarConnected ?? setup.calendarConnected,
      testConversationPassed: input.testConversationPassed ?? setup.testConversationPassed,
      activationChecklistCompleted:
        input.activationChecklistCompleted ?? setup.activationChecklistCompleted,
      updatedAt: new Date(input.updatedAt)
    });
  }

  upsertClinicKnowledge(input: ClinicKnowledgeRecord) {
    this.knowledge.set(input.id, cloneKnowledge(input));
  }

  listClinicKnowledge(clinicId: Id): ClinicKnowledgeRecord[] {
    return [...this.knowledge.values()]
      .filter((record) => record.clinicId === clinicId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.question.localeCompare(b.question))
      .map(cloneKnowledge);
  }

  isClinicActive(clinicId: Id): boolean {
    return this.setups.get(clinicId)?.lifecycleState === "active";
  }

  private requireLead(leadId: Id) {
    const lead = this.leads.get(leadId);
    if (!lead) throw new Error(`Clinic lead ${leadId} not found`);
    return cloneLead(lead);
  }

  private requireSetup(clinicId: Id) {
    const setup = this.setups.get(clinicId);
    if (!setup) throw new Error(`Clinic setup ${clinicId} not found`);
    return cloneSetup(setup);
  }
}

function cloneLead(lead: ClinicLeadRecord): ClinicLeadRecord {
  return {
    ...lead,
    submittedAt: new Date(lead.submittedAt),
    createdAt: new Date(lead.createdAt),
    updatedAt: new Date(lead.updatedAt)
  };
}

function cloneSetup(setup: ClinicSetupRecord): ClinicSetupRecord {
  return {
    ...setup,
    createdAt: setup.createdAt ? new Date(setup.createdAt) : undefined,
    updatedAt: new Date(setup.updatedAt)
  };
}

function cloneKnowledge(record: ClinicKnowledgeRecord): ClinicKnowledgeRecord {
  return { ...record, updatedAt: new Date(record.updatedAt) };
}
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
npm test -- tests/onboarding-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ports/onboarding.ts src/adapters/memory/onboarding-repository.ts tests/onboarding-repository.test.ts
git commit -m "feat: add onboarding repository port"
```

## Task 2: Add Prisma Onboarding Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260530150000_add_clinic_onboarding/migration.sql`
- Create: `src/adapters/prisma/onboarding-repository.ts`
- Create: `tests/prisma-onboarding-repository.test.ts`

- [ ] **Step 1: Write failing Prisma persistence tests**

Create `tests/prisma-onboarding-repository.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaOnboardingRepository } from "../src/adapters/prisma/onboarding-repository.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("PrismaOnboardingRepository", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repo: PrismaOnboardingRepository;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-onboarding-");
    prisma = context.prisma;
    repo = new PrismaOnboardingRepository(prisma);
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("persists lead capture and conversion", async () => {
    const lead = await repo.createLead({
      contactName: "Ana Manager",
      clinicName: "Clinica Norte",
      whatsappOrPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      professionalCount: 3,
      currentSchedulingSystem: "Google Calendar",
      monthlyWhatsappInquiries: "200-500",
      mainPain: "missed_leads",
      source: "landing",
      submittedAt: new Date("2026-06-01T12:00:00.000Z")
    });

    await repo.markLeadConverted({
      leadId: lead.id,
      clinicId: "clinic_prisma_onboarding",
      updatedAt: new Date("2026-06-01T12:30:00.000Z")
    });

    await expect(repo.getLead(lead.id)).resolves.toEqual(
      expect.objectContaining({
        id: lead.id,
        status: "converted",
        convertedClinicId: "clinic_prisma_onboarding"
      })
    );
  });

  it("persists setup, readiness flags, activation state, and knowledge", async () => {
    await repo.upsertClinicSetup({
      clinicId: "clinic_prisma_onboarding",
      source: "presencial",
      lifecycleState: "setup",
      paymentStatus: "unpaid",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      whatsappReady: false,
      calendarConnected: false,
      testConversationPassed: false,
      activationChecklistCompleted: false,
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    await repo.updateReadinessFlags({
      clinicId: "clinic_prisma_onboarding",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      updatedAt: new Date("2026-06-01T12:10:00.000Z")
    });
    await repo.updateClinicLifecycle({
      clinicId: "clinic_prisma_onboarding",
      lifecycleState: "active",
      paymentStatus: "paid",
      updatedAt: new Date("2026-06-01T12:20:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_prisma_payment",
      clinicId: "clinic_prisma_onboarding",
      category: "payment_methods",
      question: "Como se puede pagar?",
      answer: "Aceptamos transferencia, efectivo y tarjeta.",
      updatedAt: new Date("2026-06-01T12:30:00.000Z")
    });

    await expect(repo.isClinicActive("clinic_prisma_onboarding")).resolves.toBe(true);
    await expect(repo.getClinicSetup("clinic_prisma_onboarding")).resolves.toEqual(
      expect.objectContaining({
        clinicId: "clinic_prisma_onboarding",
        lifecycleState: "active",
        paymentStatus: "paid",
        whatsappReady: true,
        calendarConnected: true
      })
    );
    await expect(repo.listClinicKnowledge("clinic_prisma_onboarding")).resolves.toEqual([
      expect.objectContaining({
        id: "knowledge_prisma_payment",
        category: "payment_methods"
      })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/prisma-onboarding-repository.test.ts
```

Expected: FAIL because Prisma onboarding models and adapter do not exist.

- [ ] **Step 3: Extend Prisma schema**

Modify `prisma/schema.prisma`:

1. Add fields to `Clinic`:

```prisma
  lifecycleState             String                @default("setup")
  paymentStatus              String                @default("unpaid")
  source                     String                @default("presencial")
  primaryContactName         String?
  primaryContactPhone        String?
  city                       String?
  country                    String?
  whatsappReady              Boolean               @default(false)
  calendarConnected          Boolean               @default(false)
  testConversationPassed     Boolean               @default(false)
  activationChecklistCompleted Boolean              @default(false)
  knowledgeRecords           ClinicKnowledge[]
  convertedLeads             ClinicLead[]
```

2. Add models:

```prisma
model ClinicLead {
  id                       String   @id
  contactName              String
  clinicName               String
  whatsappOrPhone          String
  city                     String
  country                  String
  professionalCount        Int
  currentSchedulingSystem  String
  monthlyWhatsappInquiries String
  mainPain                 String
  source                   String
  status                   String
  convertedClinicId        String?
  submittedAt              DateTime
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  convertedClinic          Clinic?  @relation(fields: [convertedClinicId], references: [id])

  @@index([status, submittedAt])
  @@index([source, submittedAt])
  @@index([convertedClinicId])
}

model ClinicKnowledge {
  id          String   @id
  clinicId    String
  category    String
  question    String
  answer      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  clinic      Clinic   @relation(fields: [clinicId], references: [id])

  @@index([clinicId, category])
}
```

- [ ] **Step 4: Add migration SQL**

Create `prisma/migrations/20260530150000_add_clinic_onboarding/migration.sql`:

```sql
ALTER TABLE "Clinic" ADD COLUMN "lifecycleState" TEXT NOT NULL DEFAULT 'setup';
ALTER TABLE "Clinic" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "Clinic" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'presencial';
ALTER TABLE "Clinic" ADD COLUMN "primaryContactName" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "primaryContactPhone" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "city" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "country" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "whatsappReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "calendarConnected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "testConversationPassed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "activationChecklistCompleted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClinicLead" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contactName" TEXT NOT NULL,
  "clinicName" TEXT NOT NULL,
  "whatsappOrPhone" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "professionalCount" INTEGER NOT NULL,
  "currentSchedulingSystem" TEXT NOT NULL,
  "monthlyWhatsappInquiries" TEXT NOT NULL,
  "mainPain" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "convertedClinicId" TEXT,
  "submittedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClinicLead_convertedClinicId_fkey" FOREIGN KEY ("convertedClinicId") REFERENCES "Clinic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ClinicKnowledge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clinicId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClinicKnowledge_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ClinicLead_status_submittedAt_idx" ON "ClinicLead"("status", "submittedAt");
CREATE INDEX "ClinicLead_source_submittedAt_idx" ON "ClinicLead"("source", "submittedAt");
CREATE INDEX "ClinicLead_convertedClinicId_idx" ON "ClinicLead"("convertedClinicId");
CREATE INDEX "ClinicKnowledge_clinicId_category_idx" ON "ClinicKnowledge"("clinicId", "category");
```

- [ ] **Step 5: Add Prisma adapter**

Create `src/adapters/prisma/onboarding-repository.ts` using `randomUUID` for ids and mapping helpers. The public class must implement every method from `OnboardingRepository`.

Required id format:

```ts
const leadId = `lead_${randomUUID()}`;
```

Required active check:

```ts
async isClinicActive(clinicId: Id): Promise<boolean> {
  const clinic = await this.prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { lifecycleState: true }
  });
  return clinic?.lifecycleState === "active";
}
```

- [ ] **Step 6: Run persistence tests**

Run:

```bash
npm test -- tests/prisma-onboarding-repository.test.ts tests/onboarding-repository.test.ts
npm run typecheck
npx prisma validate
```

Expected:

- Vitest PASS.
- TypeScript PASS.
- Prisma schema valid.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260530150000_add_clinic_onboarding/migration.sql src/adapters/prisma/onboarding-repository.ts tests/prisma-onboarding-repository.test.ts
git commit -m "feat: persist clinic onboarding state"
```

## Task 3: Add Onboarding Application Service

**Files:**
- Create: `src/application/onboarding/onboarding-service.ts`
- Create: `tests/onboarding-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/onboarding-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("OnboardingService", () => {
  it("submits public leads and converts them into setup clinics", async () => {
    const context = buildContext();
    const lead = await context.service.submitLead({
      contactName: "Ana Manager",
      clinicName: "Clinica Norte",
      whatsappOrPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      professionalCount: 3,
      currentSchedulingSystem: "Google Calendar",
      monthlyWhatsappInquiries: "200-500",
      mainPain: "missed_leads"
    });

    const setup = await context.service.convertLeadToClinic({
      leadId: lead.id,
      clinicId: "clinic_norte",
      now: new Date("2026-06-01T13:00:00.000Z")
    });

    expect(setup).toEqual(
      expect.objectContaining({
        clinicId: "clinic_norte",
        leadId: lead.id,
        source: "landing",
        lifecycleState: "setup",
        paymentStatus: "unpaid"
      })
    );
    await expect(context.onboarding.getLead(lead.id)).resolves.toEqual(
      expect.objectContaining({ status: "converted", convertedClinicId: "clinic_norte" })
    );
  });

  it("blocks activation until profile, readiness, payment, and checklist are complete", async () => {
    const context = buildContext();
    await context.service.createManualClinic({
      clinicId: "clinic_1",
      clinicName: "Clinica Demo",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      source: "presencial",
      now: new Date("2026-06-01T12:00:00.000Z")
    });

    await expect(
      context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:01:00.000Z") })
    ).rejects.toThrow("Clinic clinic_1 is not ready to activate: clinic_profile, payment, whatsapp, calendar, test_conversation, activation_checklist");

    await context.operational.upsertClinicProfile(profile("clinic_1"));
    await context.service.updatePaymentStatus({
      clinicId: "clinic_1",
      paymentStatus: "paid",
      now: new Date("2026-06-01T12:02:00.000Z")
    });
    await context.service.updateReadinessFlags({
      clinicId: "clinic_1",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      now: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(
      context.service.activateClinic({ clinicId: "clinic_1", now: new Date("2026-06-01T12:04:00.000Z") })
    ).resolves.toEqual(expect.objectContaining({ lifecycleState: "active" }));
    await expect(context.onboarding.isClinicActive("clinic_1")).resolves.toBe(true);
  });
});

function buildContext() {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const service = new OnboardingService({
    onboarding,
    operational,
    now: () => new Date("2026-06-01T12:00:00.000Z")
  });
  return { onboarding, operational, service };
}

function profile(clinicId: string) {
  return parseClinicProfile({
    clinicId,
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
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/onboarding-service.test.ts
```

Expected: FAIL because `OnboardingService` does not exist.

- [ ] **Step 3: Implement service**

Create `src/application/onboarding/onboarding-service.ts` with:

- `submitLead(input)` defaulting source to `landing`;
- `createManualClinic(input)`;
- `convertLeadToClinic(input)`;
- `saveClinicProfile(profile)`;
- `updatePaymentStatus(input)`;
- `updateReadinessFlags(input)`;
- `upsertKnowledge(input)`;
- `readiness(clinicId)`;
- `activateClinic(input)`;
- `pauseClinic(input)`;
- `isClinicActive(clinicId)`.

Activation readiness must require these missing keys exactly:

```ts
const missing = [
  !profile ? "clinic_profile" : undefined,
  !paymentOk ? "payment" : undefined,
  !setup?.whatsappReady ? "whatsapp" : undefined,
  !setup?.calendarConnected ? "calendar" : undefined,
  !setup?.testConversationPassed ? "test_conversation" : undefined,
  !setup?.activationChecklistCompleted ? "activation_checklist" : undefined
].filter((value): value is string => Boolean(value));
```

Allowed payment statuses for activation:

```ts
const paymentOk = setup.paymentStatus === "paid" || setup.paymentStatus === "trial" || setup.paymentStatus === "waived";
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test -- tests/onboarding-service.test.ts tests/onboarding-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/onboarding/onboarding-service.ts tests/onboarding-service.test.ts
git commit -m "feat: add clinic onboarding service"
```

## Task 4: Add Public Lead And Internal Onboarding API Routes

**Files:**
- Create: `src/config/admin.ts`
- Create: `src/api/onboarding-routes.ts`
- Modify: `src/api/app.ts`
- Modify: `src/server.ts`
- Create: `tests/onboarding-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/onboarding-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { buildApp } from "../src/api/app.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { readAdminConfig } from "../src/config/admin.js";

describe("onboarding routes", () => {
  it("accepts public landing leads without admin auth", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      payload: {
        contactName: "Ana Manager",
        clinicName: "Clinica Norte",
        whatsappOrPhone: "+5491111111111",
        city: "Buenos Aires",
        country: "Argentina",
        professionalCount: 3,
        currentSchedulingSystem: "Google Calendar",
        monthlyWhatsappInquiries: "200-500",
        mainPain: "missed_leads"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      lead: expect.objectContaining({
        id: expect.stringMatching(/^lead_/),
        clinicName: "Clinica Norte",
        status: "lead"
      })
    });
    await app.close();
  });

  it("protects internal onboarding routes with the admin token", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/internal/onboarding/leads"
    });
    const authorized = await app.inject({
      method: "GET",
      url: "/internal/onboarding/leads",
      headers: { authorization: "Bearer secret" }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({ leads: [] });
    await app.close();
  });

  it("creates manual clinics and activates only ready paid clinics", async () => {
    const context = buildContext();
    const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

    const create = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics",
      headers: { authorization: "Bearer secret" },
      payload: {
        clinicId: "clinic_1",
        clinicName: "Clinica Demo",
        primaryContactName: "Ana Manager",
        primaryContactPhone: "+5491111111111",
        city: "Buenos Aires",
        country: "Argentina",
        source: "presencial"
      }
    });
    const activation = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/activate",
      headers: { authorization: "Bearer secret" }
    });

    expect(create.statusCode).toBe(201);
    expect(create.json()).toEqual({
      setup: expect.objectContaining({ clinicId: "clinic_1", lifecycleState: "setup" })
    });
    expect(activation.statusCode).toBe(409);
    expect(activation.json()).toEqual({
      error: "clinic_not_ready",
      missing: ["clinic_profile", "payment", "whatsapp", "calendar", "test_conversation", "activation_checklist"]
    });
    await app.close();
  });
});

describe("admin config", () => {
  it("trims admin tokens and disables blank tokens", () => {
    expect(readAdminConfig({ MOMENTUM_ADMIN_TOKEN: "  secret  " })).toEqual({ enabled: true, token: "secret" });
    expect(readAdminConfig({ MOMENTUM_ADMIN_TOKEN: "   " })).toEqual({ enabled: false });
  });
});

function buildContext() {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const service = new OnboardingService({
    onboarding,
    operational,
    now: () => new Date("2026-06-01T12:00:00.000Z")
  });
  return { onboarding, operational, service };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/onboarding-routes.test.ts
```

Expected: FAIL because onboarding routes/config do not exist.

- [ ] **Step 3: Implement admin config**

Create `src/config/admin.ts`:

```ts
export type AdminConfig = { enabled: false } | { enabled: true; token: string };

export function readAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const token = env.MOMENTUM_ADMIN_TOKEN?.trim();
  return token ? { enabled: true, token } : { enabled: false };
}
```

- [ ] **Step 4: Implement onboarding routes**

Create `src/api/onboarding-routes.ts` with:

- public `POST /leads`;
- internal `GET /internal/onboarding/leads`;
- internal `POST /internal/onboarding/clinics`;
- internal `POST /internal/onboarding/leads/:leadId/convert`;
- internal `GET /internal/onboarding/clinics`;
- internal `GET /internal/onboarding/clinics/:clinicId`;
- internal `PATCH /internal/onboarding/clinics/:clinicId/payment`;
- internal `PATCH /internal/onboarding/clinics/:clinicId/readiness`;
- internal `POST /internal/onboarding/clinics/:clinicId/activate`;
- internal `POST /internal/onboarding/clinics/:clinicId/pause`.

Use `zod` schemas and return:

- invalid public lead: `400 { error: "invalid_lead" }`;
- internal unauthorized: `401 { error: "unauthorized" }`;
- activation not ready: `409 { error: "clinic_not_ready", missing: [...] }`.

Use the same timing-safe bearer helper style as `src/api/outbound-routes.ts`.

- [ ] **Step 5: Register routes in app/server**

Modify `src/api/app.ts`:

- import `registerOnboardingRoutes`;
- add `onboarding?: OnboardingRoutesOptions` to `BuildAppOptions`;
- call `registerOnboardingRoutes(app, options.onboarding)` when provided.

Modify `src/server.ts`:

- read `readAdminConfig(process.env)`;
- when enabled and Prisma exists, construct `PrismaOnboardingRepository`, `PrismaOperationalRepository`, and `OnboardingService`;
- pass onboarding route options to `buildApp`.

If Prisma is not initialized and admin config is enabled, throw:

```ts
throw new Error("Prisma runtime is required when onboarding routes are enabled");
```

- [ ] **Step 6: Run route tests**

Run:

```bash
npm test -- tests/onboarding-routes.test.ts tests/onboarding-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config/admin.ts src/api/onboarding-routes.ts src/api/app.ts src/server.ts tests/onboarding-routes.test.ts
git commit -m "feat: expose clinic onboarding api"
```

## Task 5: Gate Production WhatsApp And Outbound Automation By Activation

**Files:**
- Modify: `src/api/whatsapp-routes.ts`
- Modify: `src/api/outbound-routes.ts`
- Modify: `src/application/outbound/outbound-automation-service.ts`
- Modify: `src/runtime/server-runtime.ts`
- Modify: `src/server.ts`
- Create: `tests/activation-gates.test.ts`

- [ ] **Step 1: Write failing activation gate tests**

Create `tests/activation-gates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createKapsoWebhookSignature } from "../src/adapters/whatsapp/kapso/signature.js";
import type { WhatsAppKapsoWebhookRoutesOptions } from "../src/api/whatsapp-routes.js";
import type { OutboundAutomationSummary } from "../src/application/outbound/outbound-automation-service.js";

describe("production activation gates", () => {
  it("ignores production WhatsApp webhooks for inactive clinics without calling inbound service", async () => {
    const inboundCalls: unknown[] = [];
    const webhook = fakeWebhook({
      inboundService: {
        handleInboundMessage: async (message: unknown) => {
          inboundCalls.push(message);
          return { status: "sent", workflowResult: "reply", providerMessageId: "msg_1" };
        }
      }
    });
    const app = buildApp({
      whatsappKapsoWebhook: webhook,
      clinicActivation: { isClinicActive: async () => false }
    });
    const rawBody = JSON.stringify(kapsoPayload());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: {
        "x-webhook-signature": createKapsoWebhookSignature(rawBody, "secret"),
        "x-idempotency-key": "delivery_inactive"
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored", reason: "clinic_inactive" });
    expect(inboundCalls).toEqual([]);
    await app.close();
  });

  it("blocks outbound route runs for inactive clinics", async () => {
    const calls: string[] = [];
    const app = buildApp({
      outboundAutomation: {
        token: "secret",
        service: {
          async runDueReminders(): Promise<OutboundAutomationSummary> {
            calls.push("reminders");
            return { sent: 1, blocked: 0, failed: 0, skipped: 0 };
          },
          async runDueReactivations(): Promise<OutboundAutomationSummary> {
            calls.push("reactivations");
            return { sent: 1, blocked: 0, failed: 0, skipped: 0 };
          }
        }
      },
      clinicActivation: { isClinicActive: async () => false }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "clinic_inactive" });
    expect(calls).toEqual([]);
    await app.close();
  });
});

function fakeWebhook(input: {
  inboundService: WhatsAppKapsoWebhookRoutesOptions["inboundService"];
}): WhatsAppKapsoWebhookRoutesOptions {
  return {
    secret: "secret",
    phoneNumberClinicMap: { "123456789012345": "clinic_1" },
    inboundService: input.inboundService
  };
}

function kapsoPayload() {
  return {
    phone_number_id: "123456789012345",
    message: {
      id: "wamid.123",
      type: "text",
      from: "5491111111111",
      text: { body: "Quiero reservar botox" }
    },
    conversation: {
      id: "conv_123",
      phone_number_id: "123456789012345",
      phone_number: "5491111111111"
    }
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/activation-gates.test.ts
```

Expected: FAIL because `clinicActivation` app option does not exist and routes do not gate inactive clinics.

- [ ] **Step 3: Add activation guard type and route gates**

Add this type in `src/api/app.ts` or a focused `src/ports/activation.ts`:

```ts
export type ClinicActivationGuard = {
  isClinicActive(clinicId: string): Promise<boolean> | boolean;
};
```

Use it in `buildApp` options as `clinicActivation?: ClinicActivationGuard`.

In `src/api/whatsapp-routes.ts`, add optional `activation?: ClinicActivationGuard`. After resolving `clinicId`, before `normalizeKapsoInboundMessage`, run:

```ts
if (options.activation && !(await options.activation.isClinicActive(clinicId))) {
  return reply.send({ status: "ignored", reason: "clinic_inactive" });
}
```

In `src/api/outbound-routes.ts`, add optional `activation?: ClinicActivationGuard`. After request body validation and before calling service methods, run:

```ts
if (options.activation && !(await options.activation.isClinicActive(parsed.data.clinicId))) {
  return reply.status(409).send({ error: "clinic_inactive" });
}
```

- [ ] **Step 4: Gate direct outbound service calls**

Modify `OutboundAutomationServiceOptions`:

```ts
  clinicActivation?: {
    isClinicActive(clinicId: string): Promise<boolean> | boolean;
  };
```

At the start of `runDueReminders`, `runDueReactivations`, and `handleFreedSlot`, return `emptySummary()` when the guard exists and returns false.

Keep existing tests passing by making the guard optional.

- [ ] **Step 5: Wire runtime/server**

In `src/runtime/server-runtime.ts`, accept optional `clinicActivation` in `buildWhatsAppRuntime` input and pass it into `OutboundAutomationService`.

In `src/server.ts`, when onboarding repository exists, pass:

```ts
const clinicActivation = onboardingRepo
  ? { isClinicActive: (clinicId: string) => onboardingRepo.isClinicActive(clinicId) }
  : undefined;
```

Then pass `clinicActivation` to `buildWhatsAppRuntime` and `buildApp`.

- [ ] **Step 6: Run activation tests**

Run:

```bash
npm test -- tests/activation-gates.test.ts tests/kapso-webhook.test.ts tests/outbound-routes.test.ts tests/outbound-automation-reminders.test.ts tests/outbound-automation-reactivation.test.ts tests/outbound-automation-freed-slot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/whatsapp-routes.ts src/api/outbound-routes.ts src/api/app.ts src/application/outbound/outbound-automation-service.ts src/runtime/server-runtime.ts src/server.ts tests/activation-gates.test.ts
git commit -m "feat: gate production automation by clinic activation"
```

## Task 6: Add Scoped Onboarding Test Mode Endpoint

**Files:**
- Create: `src/application/onboarding/test-mode-service.ts`
- Modify: `src/api/onboarding-routes.ts`
- Create: `tests/onboarding-test-mode.test.ts`

- [ ] **Step 1: Write failing test-mode tests**

Create `tests/onboarding-test-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { buildApp } from "../src/api/app.js";
import { OnboardingService } from "../src/application/onboarding/onboarding-service.js";
import { OnboardingTestModeService } from "../src/application/onboarding/test-mode-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("onboarding test mode", () => {
  it("runs a scoped test conversation for setup clinics without requiring active state", async () => {
    const context = buildContext();
    await context.onboarding.upsertClinicSetup({
      clinicId: "clinic_test",
      source: "presencial",
      lifecycleState: "setup",
      paymentStatus: "unpaid",
      primaryContactName: "Ana Manager",
      primaryContactPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      whatsappReady: false,
      calendarConnected: false,
      testConversationPassed: false,
      activationChecklistCompleted: false,
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    await context.operational.upsertClinicProfile(profile("clinic_test"));
    const app = buildApp({
      onboarding: {
        service: context.service,
        testModeService: context.testMode,
        adminToken: "secret"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_test/test-message",
      headers: { authorization: "Bearer secret" },
      payload: {
        text: "Quiero reservar botox",
        conversationId: "test_conv",
        patientId: "test_patient",
        whatsappNumber: "+5491111111111"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: expect.objectContaining({
        kind: "reply",
        text: expect.stringContaining("Tengo este horario")
      })
    });
    await expect(context.onboarding.getClinicSetup("clinic_test")).resolves.toEqual(
      expect.objectContaining({ testConversationPassed: true })
    );
    await app.close();
  });
});

function buildContext() {
  const onboarding = new InMemoryOnboardingRepository();
  const operational = new InMemoryRepositories();
  const audit = new InMemoryAuditLog();
  const calendar = new FakeCalendar();
  const service = new OnboardingService({ onboarding, operational });
  const testMode = new OnboardingTestModeService({
    onboarding,
    operational,
    audit,
    calendar,
    now: () => new Date("2026-05-29T12:00:00.000Z")
  });
  return { onboarding, operational, audit, calendar, service, testMode };
}

function profile(clinicId: string) {
  return parseClinicProfile({
    clinicId,
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
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/onboarding-test-mode.test.ts
```

Expected: FAIL because test-mode service and route do not exist.

- [ ] **Step 3: Implement test-mode service**

Create `src/application/onboarding/test-mode-service.ts`:

- construct a `SchedulingService` and `ConversationWorkflow` using injected repos/calendar/audit;
- use `RulesConversationInterpreter`;
- method `runMessage(input)` calls workflow with provided clinic/patient/conversation/text;
- after a successful result, call onboarding `updateReadinessFlags({ testConversationPassed: true })`;
- do not send WhatsApp provider messages.

- [ ] **Step 4: Add test route**

In `src/api/onboarding-routes.ts`, when `testModeService` is provided, register:

```text
POST /internal/onboarding/clinics/:clinicId/test-message
```

Payload:

```ts
{
  text: string;
  conversationId?: string;
  patientId?: string;
  whatsappNumber?: string;
}
```

Defaults:

- `conversationId`: `test:<clinicId>`;
- `patientId`: `test_patient:<clinicId>`;
- `whatsappNumber`: `+5490000000000`.

- [ ] **Step 5: Run test-mode tests**

Run:

```bash
npm test -- tests/onboarding-test-mode.test.ts tests/onboarding-routes.test.ts tests/conversation-workflow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/onboarding/test-mode-service.ts src/api/onboarding-routes.ts tests/onboarding-test-mode.test.ts
git commit -m "feat: add onboarding test mode"
```

## Task 7: Scaffold Next.js Web App

**Files:**
- Modify: `package.json`
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Add workspace package skeleton**

Modify root `package.json`:

```json
{
  "name": "momentum",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["apps/web"],
  "scripts": {
    "dev": "tsx src/server.ts",
    "dev:api": "tsx src/server.ts",
    "dev:web": "npm --workspace apps/web run dev",
    "build:web": "npm --workspace apps/web run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "typecheck:web": "npm --workspace apps/web run typecheck",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  }
}
```

Keep existing dependency versions unchanged.

Create `apps/web/package.json`:

```json
{
  "name": "@momentum/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3001",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1 --port 3001",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Install web dependencies**

Run:

```bash
npm install --workspace apps/web next react react-dom lucide-react
npm install --workspace apps/web --save-dev @types/react @types/react-dom typescript
```

Expected:

- `package-lock.json` updates.
- `apps/web/package.json` contains web dependencies.

- [ ] **Step 3: Add minimal Next app**

Create `apps/web/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

export default nextConfig;
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Momentum | AI receptionist for aesthetic clinics",
  description: "Turn WhatsApp conversations into confirmed appointments with Momentum."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Momentum AI Receptionist</p>
        <h1>Turn WhatsApp into your clinic&apos;s appointment engine.</h1>
        <p className="hero-copy">
          Momentum answers leads, books real calendar slots, reschedules, reminds, and reactivates
          warm patients for aesthetic clinics.
        </p>
        <a className="primary-link" href="/lead">
          Activate a pilot
        </a>
      </section>
    </main>
  );
}
```

Create `apps/web/src/app/globals.css`:

```css
:root {
  color-scheme: dark;
  --bg: #071013;
  --text: #f7fbf8;
  --muted: #a7b6b2;
  --accent: #38f2b2;
  --panel: #101a1d;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.page-shell {
  min-height: 100vh;
}

.hero {
  display: grid;
  align-content: center;
  min-height: 100vh;
  width: min(1120px, calc(100% - 40px));
  margin: 0 auto;
}

.eyebrow {
  color: var(--accent);
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  max-width: 820px;
  margin: 0;
  font-size: clamp(3rem, 8vw, 6.5rem);
  line-height: 0.95;
  letter-spacing: 0;
}

.hero-copy {
  max-width: 660px;
  color: var(--muted);
  font-size: 1.2rem;
  line-height: 1.6;
}

.primary-link {
  display: inline-flex;
  width: fit-content;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 0 18px;
  background: var(--accent);
  color: #062018;
  font-weight: 800;
  text-decoration: none;
}
```

Create `apps/web/src/lib/types.ts`:

```ts
export type LeadMainPain =
  | "missed_leads"
  | "reception_load"
  | "reactivation"
  | "no_shows"
  | "rescheduling"
  | "other";
```

Create `apps/web/src/lib/api.ts`:

```ts
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
```

- [ ] **Step 4: Build web app**

Run:

```bash
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json apps/web
git commit -m "feat: scaffold momentum web app"
```

## Task 8: Build Premium Public Landing And Lead Form UI

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/lead/page.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Replace landing with full premium sections**

Implement `apps/web/src/app/page.tsx` with these sections:

- hero with WhatsApp/calendar product mockup;
- problem section;
- product flow section;
- automation surface;
- trust and control;
- final CTA.

Required visible copy:

```text
Turn WhatsApp into your clinic's appointment engine.
Every unanswered WhatsApp is demand cooling down.
Agenda real. Conversations reales. Turnos confirmados.
Not a chatbot. A booking operator for aesthetic clinics.
Your calendar stays the source of truth.
```

Use lucide-react icons for section details: `MessageCircle`, `CalendarCheck`, `Clock3`, `UserRoundCheck`, `ShieldCheck`, `Sparkles`.

- [ ] **Step 2: Add lead form page**

Create `apps/web/src/app/lead/page.tsx` as a client component with fields:

- contactName;
- clinicName;
- whatsappOrPhone;
- city;
- country;
- professionalCount;
- currentSchedulingSystem;
- monthlyWhatsappInquiries;
- mainPain.

Submit to:

```ts
await fetch(`${apiBaseUrl}/leads`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload)
});
```

Success copy:

```text
Listo. Vamos a revisar tu clínica y contactarte para activar un piloto asistido.
```

Failure copy:

```text
No pudimos enviar la solicitud. Probá de nuevo o escribinos por WhatsApp.
```

- [ ] **Step 3: Polish responsive CSS**

Update `apps/web/src/app/globals.css`:

- avoid single-hue purple/blue/brown/beige themes;
- use stable dimensions for mockup panels;
- ensure CTA buttons fit on 320px mobile;
- no nested cards;
- no decorative orb backgrounds;
- cards radius max 8px.

- [ ] **Step 4: Verify web build and visual page load**

Run:

```bash
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Expected: PASS.

Start dev server:

```bash
npm --workspace apps/web run dev
```

Expected: Next starts at `http://127.0.0.1:3001`.

Use Browser or Playwright verification to open:

- `http://127.0.0.1:3001`
- `http://127.0.0.1:3001/lead`

Expected:

- landing renders nonblank desktop and mobile;
- hero text does not overlap;
- lead form is usable;
- no console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app apps/web/src/lib
git commit -m "feat: build premium landing funnel"
```

## Task 9: Build Private Onboarding UI

**Files:**
- Create: `apps/web/src/app/internal/onboarding/page.tsx`
- Create: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`
- Create: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`
- Create: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/activation/page.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add internal API client helpers**

In `apps/web/src/lib/api.ts`, add:

```ts
export function adminHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 2: Add internal overview page**

Create `apps/web/src/app/internal/onboarding/page.tsx` with:

- admin token input stored in component state;
- button to load leads and clinic setups;
- list of leads;
- form to create manual clinic;
- link to each clinic setup page.

The page must show:

```text
Momentum Clinic Onboarding
Leads
Clinics
Create clinic manually
```

- [ ] **Step 3: Add clinic setup page**

Create `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx` with:

- clinic status summary;
- payment status control;
- readiness flag controls;
- knowledge/FAQ editor for payment/insurance/address/policy;
- links to test and activation pages.

This page can use simple JSON textareas for the first implementation where full dynamic service/professional editing would be too large. It must still save through backend APIs and avoid source-code edits.

- [ ] **Step 4: Add test mode page**

Create `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx` with:

- message textarea;
- "Run test" button;
- response panel;
- visible status when test passes.

Default message:

```text
Hola, quiero reservar botox.
```

- [ ] **Step 5: Add activation page**

Create `apps/web/src/app/internal/onboarding/clinics/[clinicId]/activation/page.tsx` with:

- readiness checklist;
- payment state;
- activate button;
- pause button;
- display missing readiness keys returned by backend.

- [ ] **Step 6: Verify UI**

Run:

```bash
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Expected: PASS.

Use Browser/Playwright at:

- `http://127.0.0.1:3001/internal/onboarding`

Expected:

- page renders;
- token input visible;
- no console errors;
- mobile viewport has no overlapping controls.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/internal apps/web/src/lib apps/web/src/app/globals.css
git commit -m "feat: add private onboarding ui"
```

## Task 10: Add Profile Setup APIs For Services, Professionals, Rules, And FAQs

**Files:**
- Modify: `src/api/onboarding-routes.ts`
- Modify: `src/application/onboarding/onboarding-service.ts`
- Modify: `tests/onboarding-routes.test.ts`
- Modify: `tests/onboarding-service.test.ts`
- Modify: `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`

- [ ] **Step 1: Add failing tests for saving clinic profile**

Append to `tests/onboarding-routes.test.ts`:

```ts
it("saves a real clinic profile through internal onboarding", async () => {
  const context = buildContext();
  const app = buildApp({ onboarding: { service: context.service, adminToken: "secret" } });

  const response = await app.inject({
    method: "PUT",
    url: "/internal/onboarding/clinics/clinic_1/profile",
    headers: { authorization: "Bearer secret" },
    payload: {
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
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ profile: expect.objectContaining({ clinicId: "clinic_1", name: "Clinica Demo" }) });
  await expect(context.operational.getClinicProfile("clinic_1")).resolves.toEqual(
    expect.objectContaining({ clinicId: "clinic_1", services: [expect.objectContaining({ id: "svc_botox" })] })
  );
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/onboarding-routes.test.ts
```

Expected: FAIL because profile route does not exist.

- [ ] **Step 3: Add profile save endpoint**

In `src/api/onboarding-routes.ts`, add:

```text
PUT /internal/onboarding/clinics/:clinicId/profile
```

Payload is the existing `ClinicProfile` shape without `clinicId`; route injects `clinicId` from params and calls `OnboardingService.saveClinicProfile`.

Invalid payload returns:

```json
{ "error": "invalid_clinic_profile" }
```

- [ ] **Step 4: Wire setup UI to profile API**

Update `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx` to include a "Clinic profile JSON" textarea prefilled with a valid example for one clinic and save button that calls the profile endpoint.

Use this initial JSON:

```json
{
  "name": "Clinica Demo",
  "timezone": "America/Argentina/Buenos_Aires",
  "services": [
    {
      "id": "svc_botox",
      "name": "Botox",
      "durationMinutes": 30,
      "priceText": "Desde $120.000",
      "preparation": "Evitar alcohol 24 horas antes.",
      "restrictions": [],
      "professionalIds": ["pro_perez"]
    }
  ],
  "professionals": [
    {
      "id": "pro_perez",
      "name": "Dra. Perez",
      "calendarId": "cal_perez",
      "workingHours": [{ "day": 1, "startTime": "09:00", "endTime": "17:00" }]
    }
  ],
  "appointmentRules": { "minimumNoticeMinutes": 0, "cancellationNoticeMinutes": 1440, "bufferMinutes": 0 },
  "requiredPatientFields": ["fullName"]
}
```

- [ ] **Step 5: Run profile route and web checks**

Run:

```bash
npm test -- tests/onboarding-routes.test.ts tests/onboarding-service.test.ts
npm run typecheck
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/onboarding-routes.ts src/application/onboarding/onboarding-service.ts tests/onboarding-routes.test.ts tests/onboarding-service.test.ts apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx
git commit -m "feat: save clinic profile from onboarding"
```

## Task 11: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

Add:

```bash
MOMENTUM_ADMIN_TOKEN="local-admin-token"
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000"
```

- [ ] **Step 2: Update README**

Add section after "Outbound Automation Local Run":

```md
## Public Landing And Clinic Onboarding Local Setup

Momentum includes a public landing page and a private onboarding flow for assisted clinic activation.

Start the API:

```bash
MOMENTUM_ADMIN_TOKEN="local-admin-token" ENABLE_SIMULATION_API=true npm run dev:api
```

Start the web app:

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000" npm run dev:web
```

Open:

- `http://127.0.0.1:3001` for the public landing.
- `http://127.0.0.1:3001/lead` for lead capture.
- `http://127.0.0.1:3001/internal/onboarding` for private onboarding.

Use `local-admin-token` in the private onboarding screen.

Clinic production WhatsApp and outbound automation remain disabled until the clinic is marked active.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test -- --run
npx prisma validate
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
git diff --check
```

Expected:

- backend typecheck exits 0;
- Vitest reports all test files passing;
- Prisma reports schema valid;
- web typecheck exits 0;
- Next build exits 0;
- diff check exits 0.

- [ ] **Step 4: Browser verification**

Start both servers:

```bash
MOMENTUM_ADMIN_TOKEN="local-admin-token" ENABLE_SIMULATION_API=true npm run dev:api
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3000" npm run dev:web
```

Use Browser/Playwright to verify:

- desktop `http://127.0.0.1:3001`;
- mobile `http://127.0.0.1:3001`;
- `http://127.0.0.1:3001/lead`;
- `http://127.0.0.1:3001/internal/onboarding`.

Expected:

- all pages nonblank;
- no console errors;
- landing visual hierarchy is premium and modern;
- no text overlap at mobile width;
- lead form can submit to local API;
- private onboarding loads with admin token.

- [ ] **Step 5: Commit docs**

```bash
git add README.md .env.example
git commit -m "docs: document landing onboarding activation"
```

## Self-Review Checklist

- Spec coverage:
  - Landing page: Tasks 7, 8, 11.
  - Lead capture: Tasks 2, 4, 8.
  - Private onboarding: Tasks 1, 2, 3, 4, 9, 10.
  - Activation states/payment status: Tasks 1, 2, 3, 4, 5.
  - Test mode: Task 6 and Task 9.
  - Production activation gates: Task 5.
  - Real clinic profile persistence: Task 10.
  - No automated checkout/customer dashboard/self-serve WhatsApp: enforced by scope and non-goals.
- Type consistency:
  - `ClinicLifecycleState`, `ClinicPaymentStatus`, `ClinicLeadSource`, and readiness keys are defined once in `src/ports/onboarding.ts`.
  - Web DTOs mirror backend route payloads.
  - Activation guard is shared by WhatsApp routes, outbound routes, and outbound service.
- Verification:
  - Full backend and web verification is required before completion.
  - Browser verification is required because this block introduces frontend UI.
