# Momentum MVP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable backend slice of Momentum: clinic profile configuration, deterministic appointment workflows, calendar abstraction, audit trail, and a local WhatsApp-style simulation API.

**Architecture:** Build a TypeScript backend service with clear boundaries: domain models, application workflows, ports for external systems, and adapters for local testing. The first slice uses a fake calendar adapter and local HTTP endpoints so the appointment lifecycle can be tested before wiring real WhatsApp, Google Calendar, Outlook, and OpenAI adapters.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Zod, Vitest, Prisma with SQLite for local development, OpenAI SDK interface prepared behind an adapter boundary.

---

## Scope Check

The PRD covers multiple independent subsystems: WhatsApp provider integration, Google Calendar, Outlook, AI intent interpretation, reminders, reactivation, freed-slot matching, handoff, auditing, and onboarding.

This plan intentionally implements the first working vertical slice:
- Local backend scaffold.
- Clinic operating profile.
- Calendar and messaging ports.
- Fake calendar adapter.
- Booking, rescheduling, cancellation, reminder policy, reactivation policy, freed-slot matching, opt-out, handoff state, and audit trail.
- Local HTTP endpoints that simulate inbound WhatsApp messages.

Separate follow-up plans should implement:
- Official WhatsApp Business Platform provider.
- Google Calendar OAuth and calendar adapter.
- Outlook OAuth and calendar adapter.
- OpenAI-powered intent interpreter and eval harness.
- Production deployment, queues, cron jobs, and observability.

## File Structure

- `package.json`: npm scripts and dependencies.
- `tsconfig.json`: TypeScript configuration.
- `vitest.config.ts`: unit test configuration.
- `prisma/schema.prisma`: local database schema for clinics, services, professionals, conversations, appointments, audit logs, opt-outs, interests.
- `src/domain/types.ts`: shared domain types and enums.
- `src/domain/errors.ts`: typed domain errors.
- `src/domain/clinic-profile.ts`: clinic profile validation helpers.
- `src/ports/calendar.ts`: calendar interface used by application code.
- `src/ports/clock.ts`: injectable clock interface.
- `src/ports/audit-log.ts`: audit logger interface.
- `src/adapters/memory/fake-calendar.ts`: deterministic in-memory calendar for tests/local simulation.
- `src/adapters/memory/audit-log.ts`: in-memory audit logger.
- `src/adapters/memory/repositories.ts`: local repositories for clinic profile, conversations, interests, opt-outs, and appointments.
- `src/application/scheduling/scheduling-service.ts`: booking, rescheduling, cancellation, and availability workflows.
- `src/application/conversations/intent.ts`: structured intent model and minimal rule-based interpreter for local tests.
- `src/application/conversations/conversation-workflow.ts`: routes inbound patient messages to booking/reschedule/cancel/handoff/reply actions.
- `src/application/outbound/reminder-policy.ts`: 72h, 24h, and same-day reminder rules.
- `src/application/outbound/reactivation-policy.ts`: previous-lead reactivation rules and opt-out handling.
- `src/application/outbound/freed-slot-service.ts`: matches newly available slots to interested patients.
- `src/api/app.ts`: Fastify app factory.
- `src/api/routes.ts`: local simulation endpoints.
- `src/server.ts`: HTTP server entrypoint.
- `src/dev/seed.ts`: sample clinic configuration.
- `tests/*.test.ts`: focused unit and integration tests.

## Task 1: Scaffold TypeScript Backend

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/server.ts`
- Create: `src/api/app.ts`
- Test: `tests/health.test.ts`

- [ ] **Step 1: Create package manifest**

Create `package.json` with this content:

```json
{
  "name": "momentum",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "dotenv": "^16.4.7",
    "fastify": "^5.0.0",
    "openai": "^5.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "prisma": "^6.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: npm installs dependencies and creates `package-lock.json`.

- [ ] **Step 3: Create TypeScript config**

Create `tsconfig.json` with this content:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create Vitest config**

Create `vitest.config.ts` with this content:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 5: Write failing health test**

Create `tests/health.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";

describe("health endpoint", () => {
  it("returns ok", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run:

```bash
npm test -- tests/health.test.ts
```

Expected: FAIL because `src/api/app.ts` does not exist.

- [ ] **Step 7: Implement app factory and server**

Create `src/api/app.ts` with this content:

```ts
import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  return app;
}
```

Create `src/server.ts` with this content:

```ts
import "dotenv/config";
import { buildApp } from "./api/app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();

await app.listen({ port, host });
console.log(`Momentum API listening on http://${host}:${port}`);
```

- [ ] **Step 8: Run verification**

Run:

```bash
npm test -- tests/health.test.ts
npm run typecheck
```

Expected: PASS for health test and typecheck exits with code 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/server.ts src/api/app.ts tests/health.test.ts
git commit -m "chore: scaffold momentum backend"
```

Expected: commit succeeds.

## Task 2: Add Domain Types And Clinic Profile Validation

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/errors.ts`
- Create: `src/domain/clinic-profile.ts`
- Test: `tests/clinic-profile.test.ts`

- [ ] **Step 1: Write failing clinic profile tests**

Create `tests/clinic-profile.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("clinic profile", () => {
  it("accepts one site, multiple professionals, and reservable services", () => {
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
          restrictions: ["No se brinda diagnostico por WhatsApp."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [
        {
          id: "pro_perez",
          name: "Dra. Perez",
          calendarId: "cal_perez"
        }
      ],
      appointmentRules: {
        minimumNoticeMinutes: 120,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0
      },
      requiredPatientFields: ["fullName"]
    });

    expect(profile.services[0]?.professionalIds).toEqual(["pro_perez"]);
  });

  it("rejects a service mapped to a missing professional", () => {
    expect(() =>
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
            preparation: "Sin preparacion especial.",
            restrictions: [],
            professionalIds: ["pro_missing"]
          }
        ],
        professionals: [],
        appointmentRules: {
          minimumNoticeMinutes: 120,
          cancellationNoticeMinutes: 1440,
          bufferMinutes: 0
        },
        requiredPatientFields: ["fullName"]
      })
    ).toThrow("Service svc_botox references missing professional pro_missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/clinic-profile.test.ts
```

Expected: FAIL because `src/domain/clinic-profile.ts` does not exist.

- [ ] **Step 3: Add domain errors**

Create `src/domain/errors.ts` with this content:

```ts
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
```

- [ ] **Step 4: Add domain types**

Create `src/domain/types.ts` with this content:

```ts
export type Id = string;

export type PatientField = "fullName" | "email" | "dni" | "insurance";

export type Service = {
  id: Id;
  name: string;
  durationMinutes: number;
  priceText: string;
  preparation: string;
  restrictions: string[];
  professionalIds: Id[];
};

export type Professional = {
  id: Id;
  name: string;
  calendarId: Id;
};

export type AppointmentRules = {
  minimumNoticeMinutes: number;
  cancellationNoticeMinutes: number;
  bufferMinutes: number;
};

export type ClinicProfile = {
  clinicId: Id;
  name: string;
  timezone: string;
  services: Service[];
  professionals: Professional[];
  appointmentRules: AppointmentRules;
  requiredPatientFields: PatientField[];
};

export type Patient = {
  id: Id;
  whatsappNumber: string;
  fullName?: string;
};

export type AppointmentStatus = "scheduled" | "cancelled";

export type Appointment = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  serviceId: Id;
  professionalId: Id;
  calendarEventId: Id;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
};

export type TimeSlot = {
  professionalId: Id;
  calendarId: Id;
  startsAt: Date;
  endsAt: Date;
};
```

- [ ] **Step 5: Add clinic profile parser**

Create `src/domain/clinic-profile.ts` with this content:

```ts
import { z } from "zod";
import { DomainError } from "./errors.js";

const clinicProfileSchema = z.object({
  clinicId: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  services: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      durationMinutes: z.number().int().positive(),
      priceText: z.string().min(1),
      preparation: z.string(),
      restrictions: z.array(z.string()),
      professionalIds: z.array(z.string().min(1)).min(1)
    })
  ),
  professionals: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      calendarId: z.string().min(1)
    })
  ),
  appointmentRules: z.object({
    minimumNoticeMinutes: z.number().int().nonnegative(),
    cancellationNoticeMinutes: z.number().int().nonnegative(),
    bufferMinutes: z.number().int().nonnegative()
  }),
  requiredPatientFields: z.array(z.enum(["fullName", "email", "dni", "insurance"]))
});

export type ClinicProfileInput = z.input<typeof clinicProfileSchema>;

export function parseClinicProfile(input: ClinicProfileInput) {
  const profile = clinicProfileSchema.parse(input);
  const professionalIds = new Set(profile.professionals.map((professional) => professional.id));

  for (const service of profile.services) {
    for (const professionalId of service.professionalIds) {
      if (!professionalIds.has(professionalId)) {
        throw new DomainError(`Service ${service.id} references missing professional ${professionalId}`);
      }
    }
  }

  return profile;
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test -- tests/clinic-profile.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/domain/types.ts src/domain/errors.ts src/domain/clinic-profile.ts tests/clinic-profile.test.ts
git commit -m "feat: add clinic profile domain"
```

Expected: commit succeeds.

## Task 3: Add Calendar Port And Fake Calendar Adapter

**Files:**
- Create: `src/ports/calendar.ts`
- Create: `src/adapters/memory/fake-calendar.ts`
- Test: `tests/fake-calendar.test.ts`

- [ ] **Step 1: Write failing fake calendar tests**

Create `tests/fake-calendar.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";

describe("FakeCalendar", () => {
  it("returns free slots that do not overlap existing events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Existing",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_existing" }
    });

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z"),
      durationMinutes: 30
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/fake-calendar.test.ts
```

Expected: FAIL because `src/adapters/memory/fake-calendar.ts` does not exist.

- [ ] **Step 3: Add calendar port**

Create `src/ports/calendar.ts` with this content:

```ts
export type CalendarSlot = {
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
};

export type CalendarEventInput = {
  calendarId: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  metadata: Record<string, string>;
};

export type CalendarEvent = CalendarEventInput & {
  id: string;
  status: "scheduled" | "cancelled";
};

export type FindFreeSlotsInput = {
  calendarIds: string[];
  from: Date;
  to: Date;
  durationMinutes: number;
};

export interface CalendarPort {
  findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  cancelEvent(eventId: string): Promise<CalendarEvent>;
  getEvent(eventId: string): Promise<CalendarEvent | undefined>;
}
```

- [ ] **Step 4: Add fake calendar adapter**

Create `src/adapters/memory/fake-calendar.ts` with this content:

```ts
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPort,
  CalendarSlot,
  FindFreeSlotsInput
} from "../../ports/calendar.js";

type AvailabilitySeed = {
  startsAt: Date;
  endsAt: Date;
};

export class FakeCalendar implements CalendarPort {
  private availability = new Map<string, AvailabilitySeed[]>();
  private events = new Map<string, CalendarEvent>();
  private eventCounter = 0;

  seedAvailability(calendarId: string, slots: AvailabilitySeed[]) {
    this.availability.set(calendarId, slots);
  }

  async findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]> {
    const results: CalendarSlot[] = [];

    for (const calendarId of input.calendarIds) {
      const available = this.availability.get(calendarId) ?? [];
      const activeEvents = [...this.events.values()].filter(
        (event) => event.calendarId === calendarId && event.status === "scheduled"
      );

      for (const slot of available) {
        const duration = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60000;
        const insideWindow = slot.startsAt >= input.from && slot.endsAt <= input.to;
        const longEnough = duration >= input.durationMinutes;
        const overlaps = activeEvents.some(
          (event) => slot.startsAt < event.endsAt && slot.endsAt > event.startsAt
        );

        if (insideWindow && longEnough && !overlaps) {
          results.push({ calendarId, startsAt: slot.startsAt, endsAt: slot.endsAt });
        }
      }
    }

    return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    this.eventCounter += 1;
    const event: CalendarEvent = {
      id: `evt_${this.eventCounter}`,
      status: "scheduled",
      ...input
    };
    this.events.set(event.id, event);
    return event;
  }

  async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new Error(`Calendar event ${eventId} not found`);
    }

    const updated: CalendarEvent = {
      ...input,
      id: eventId,
      status: existing.status
    };
    this.events.set(eventId, updated);
    return updated;
  }

  async cancelEvent(eventId: string): Promise<CalendarEvent> {
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new Error(`Calendar event ${eventId} not found`);
    }

    const cancelled = { ...existing, status: "cancelled" as const };
    this.events.set(eventId, cancelled);
    return cancelled;
  }

  async getEvent(eventId: string): Promise<CalendarEvent | undefined> {
    return this.events.get(eventId);
  }
}
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm test -- tests/fake-calendar.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/ports/calendar.ts src/adapters/memory/fake-calendar.ts tests/fake-calendar.test.ts
git commit -m "feat: add calendar port"
```

Expected: commit succeeds.

## Task 4: Add Audit Trail And In-Memory Repositories

**Files:**
- Create: `src/ports/audit-log.ts`
- Create: `src/adapters/memory/audit-log.ts`
- Create: `src/adapters/memory/repositories.ts`
- Test: `tests/audit-log.test.ts`

- [ ] **Step 1: Write failing audit test**

Create `tests/audit-log.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";

describe("InMemoryAuditLog", () => {
  it("records ordered audit events", async () => {
    const audit = new InMemoryAuditLog();

    await audit.record({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      type: "appointment.created",
      message: "Created appointment",
      metadata: { appointmentId: "appt_1" }
    });

    expect(await audit.list()).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "appointment.created",
        message: "Created appointment",
        metadata: { appointmentId: "appt_1" }
      })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/audit-log.test.ts
```

Expected: FAIL because `src/adapters/memory/audit-log.ts` does not exist.

- [ ] **Step 3: Add audit port**

Create `src/ports/audit-log.ts` with this content:

```ts
export type AuditEventInput = {
  clinicId: string;
  conversationId?: string;
  type: string;
  message: string;
  metadata: Record<string, string>;
};

export type AuditEvent = AuditEventInput & {
  id: string;
  createdAt: Date;
};

export interface AuditLogPort {
  record(input: AuditEventInput): Promise<AuditEvent>;
}
```

- [ ] **Step 4: Add memory audit log**

Create `src/adapters/memory/audit-log.ts` with this content:

```ts
import type { AuditEvent, AuditEventInput, AuditLogPort } from "../../ports/audit-log.js";

export class InMemoryAuditLog implements AuditLogPort {
  private events: AuditEvent[] = [];
  private counter = 0;

  async record(input: AuditEventInput): Promise<AuditEvent> {
    this.counter += 1;
    const event: AuditEvent = {
      id: `audit_${this.counter}`,
      createdAt: new Date(),
      ...input
    };
    this.events.push(event);
    return event;
  }

  async list(): Promise<AuditEvent[]> {
    return [...this.events];
  }
}
```

- [ ] **Step 5: Add repositories**

Create `src/adapters/memory/repositories.ts` with this content:

```ts
import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";

export type Conversation = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  botPaused: boolean;
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

export class InMemoryRepositories {
  clinicProfiles = new Map<Id, ClinicProfile>();
  patients = new Map<Id, Patient>();
  conversations = new Map<Id, Conversation>();
  appointments = new Map<Id, Appointment>();
  interests = new Map<Id, PatientInterest>();
  optOutWhatsappNumbers = new Set<string>();

  upsertClinicProfile(profile: ClinicProfile) {
    this.clinicProfiles.set(profile.clinicId, profile);
  }

  getClinicProfile(clinicId: Id) {
    return this.clinicProfiles.get(clinicId);
  }

  upsertPatient(patient: Patient) {
    this.patients.set(patient.id, patient);
  }

  getPatient(patientId: Id) {
    return this.patients.get(patientId);
  }

  saveConversation(conversation: Conversation) {
    this.conversations.set(conversation.id, conversation);
  }

  getConversation(conversationId: Id) {
    return this.conversations.get(conversationId);
  }

  saveAppointment(appointment: Appointment) {
    this.appointments.set(appointment.id, appointment);
  }

  getAppointment(appointmentId: Id) {
    return this.appointments.get(appointmentId);
  }

  listAppointmentsByPatient(patientId: Id) {
    return [...this.appointments.values()].filter((appointment) => appointment.patientId === patientId);
  }

  saveInterest(interest: PatientInterest) {
    this.interests.set(interest.id, interest);
  }

  listActiveInterests() {
    return [...this.interests.values()].filter((interest) => interest.status === "active");
  }

  markOptOut(whatsappNumber: string) {
    this.optOutWhatsappNumbers.add(whatsappNumber);
  }

  isOptedOut(whatsappNumber: string) {
    return this.optOutWhatsappNumbers.has(whatsappNumber);
  }
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test -- tests/audit-log.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/ports/audit-log.ts src/adapters/memory/audit-log.ts src/adapters/memory/repositories.ts tests/audit-log.test.ts
git commit -m "feat: add audit trail"
```

Expected: commit succeeds.

## Task 5: Add Scheduling Service

**Files:**
- Create: `src/application/scheduling/scheduling-service.ts`
- Test: `tests/scheduling-service.test.ts`

- [ ] **Step 1: Write failing scheduling tests**

Create `tests/scheduling-service.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

function buildContext() {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();

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

  repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
  ]);

  return { repos, calendar, audit, service: new SchedulingService(repos, calendar, audit) };
}

describe("SchedulingService", () => {
  it("books a compatible professional slot and audits the action", async () => {
    const { repos, audit, service } = buildContext();

    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    expect(appointment.status).toBe("scheduled");
    expect(repos.getAppointment(appointment.id)).toEqual(appointment);
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.created");
  });

  it("reschedules an appointment into a newly available slot", async () => {
    const { calendar, audit, service } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);

    const original = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    const rescheduled = await service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: original.id,
      startsAt: new Date("2026-06-02T14:00:00.000Z"),
      conversationId: "conv_1"
    });

    expect(rescheduled.startsAt).toEqual(new Date("2026-06-02T14:00:00.000Z"));
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.rescheduled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/scheduling-service.test.ts
```

Expected: FAIL because `src/application/scheduling/scheduling-service.ts` does not exist.

- [ ] **Step 3: Add scheduling service**

Create `src/application/scheduling/scheduling-service.ts` with this content:

```ts
import type { InMemoryRepositories } from "../../adapters/memory/repositories.js";
import type { Appointment } from "../../domain/types.js";
import { DomainError } from "../../domain/errors.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { CalendarPort, CalendarSlot } from "../../ports/calendar.js";

type BookAppointmentInput = {
  clinicId: string;
  patientId: string;
  serviceId: string;
  startsAt: Date;
  professionalId: string;
  conversationId?: string;
};

export class SchedulingService {
  constructor(
    private readonly repos: InMemoryRepositories,
    private readonly calendar: CalendarPort,
    private readonly audit: AuditLogPort
  ) {}

  async findSlots(input: {
    clinicId: string;
    serviceId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<CalendarSlot[]> {
    const profile = this.requireProfile(input.clinicId);
    const service = profile.services.find((candidate) => candidate.id === input.serviceId);
    if (!service) {
      throw new DomainError(`Service ${input.serviceId} not found`);
    }

    const professionals = profile.professionals.filter((professional) => {
      const serviceCompatible = service.professionalIds.includes(professional.id);
      const requested = input.professionalId ? professional.id === input.professionalId : true;
      return serviceCompatible && requested;
    });

    return this.calendar.findFreeSlots({
      calendarIds: professionals.map((professional) => professional.calendarId),
      from: input.from,
      to: input.to,
      durationMinutes: service.durationMinutes
    });
  }

  async bookAppointment(input: BookAppointmentInput): Promise<Appointment> {
    const profile = this.requireProfile(input.clinicId);
    const service = profile.services.find((candidate) => candidate.id === input.serviceId);
    if (!service) {
      throw new DomainError(`Service ${input.serviceId} not found`);
    }

    const professional = profile.professionals.find((candidate) => candidate.id === input.professionalId);
    if (!professional || !service.professionalIds.includes(professional.id)) {
      throw new DomainError(`Professional ${input.professionalId} cannot perform service ${input.serviceId}`);
    }

    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
    const slots = await this.calendar.findFreeSlots({
      calendarIds: [professional.calendarId],
      from: startsAt,
      to: endsAt,
      durationMinutes: service.durationMinutes
    });
    const exactSlot = slots.find(
      (slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.endsAt.getTime() === endsAt.getTime()
    );
    if (!exactSlot) {
      throw new DomainError("Selected slot is no longer available");
    }

    const appointmentId = `appt_${Date.now()}`;
    const event = await this.calendar.createEvent({
      calendarId: professional.calendarId,
      summary: `${service.name} - ${input.patientId}`,
      startsAt,
      endsAt,
      metadata: { appointmentId, patientId: input.patientId, serviceId: input.serviceId }
    });

    const appointment: Appointment = {
      id: appointmentId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      serviceId: input.serviceId,
      professionalId: professional.id,
      calendarEventId: event.id,
      startsAt,
      endsAt,
      status: "scheduled"
    };

    this.repos.saveAppointment(appointment);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "appointment.created",
      message: "Created appointment",
      metadata: { appointmentId: appointment.id, calendarEventId: event.id }
    });

    return appointment;
  }

  async cancelAppointment(input: { clinicId: string; appointmentId: string; conversationId?: string }) {
    const appointment = this.repos.getAppointment(input.appointmentId);
    if (!appointment) {
      throw new DomainError(`Appointment ${input.appointmentId} not found`);
    }

    await this.calendar.cancelEvent(appointment.calendarEventId);
    const cancelled: Appointment = { ...appointment, status: "cancelled" };
    this.repos.saveAppointment(cancelled);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "appointment.cancelled",
      message: "Cancelled appointment",
      metadata: { appointmentId: appointment.id }
    });
    return cancelled;
  }

  async rescheduleAppointment(input: {
    clinicId: string;
    appointmentId: string;
    startsAt: Date;
    conversationId?: string;
  }): Promise<Appointment> {
    const appointment = this.repos.getAppointment(input.appointmentId);
    if (!appointment) {
      throw new DomainError(`Appointment ${input.appointmentId} not found`);
    }

    const profile = this.requireProfile(input.clinicId);
    const service = profile.services.find((candidate) => candidate.id === appointment.serviceId);
    const professional = profile.professionals.find((candidate) => candidate.id === appointment.professionalId);
    if (!service || !professional) {
      throw new DomainError(`Appointment ${appointment.id} references missing service or professional`);
    }

    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
    const slots = await this.calendar.findFreeSlots({
      calendarIds: [professional.calendarId],
      from: startsAt,
      to: endsAt,
      durationMinutes: service.durationMinutes
    });
    const exactSlot = slots.find(
      (slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.endsAt.getTime() === endsAt.getTime()
    );
    if (!exactSlot) {
      throw new DomainError("Selected reschedule slot is no longer available");
    }

    await this.calendar.updateEvent(appointment.calendarEventId, {
      calendarId: professional.calendarId,
      summary: `${service.name} - ${appointment.patientId}`,
      startsAt,
      endsAt,
      metadata: {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        serviceId: appointment.serviceId
      }
    });

    const updated: Appointment = { ...appointment, startsAt, endsAt };
    this.repos.saveAppointment(updated);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "appointment.rescheduled",
      message: "Rescheduled appointment",
      metadata: { appointmentId: appointment.id }
    });

    return updated;
  }

  private requireProfile(clinicId: string) {
    const profile = this.repos.getClinicProfile(clinicId);
    if (!profile) {
      throw new DomainError(`Clinic ${clinicId} not configured`);
    }
    return profile;
  }
}
```

- [ ] **Step 4: Run verification**

Run:

```bash
npm test -- tests/scheduling-service.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/application/scheduling/scheduling-service.ts tests/scheduling-service.test.ts
git commit -m "feat: add scheduling service"
```

Expected: commit succeeds.

## Task 6: Add Conversation Intent And Booking Workflow

**Files:**
- Create: `src/application/conversations/intent.ts`
- Create: `src/application/conversations/conversation-workflow.ts`
- Test: `tests/conversation-workflow.test.ts`

- [ ] **Step 1: Write failing workflow test**

Create `tests/conversation-workflow.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("ConversationWorkflow", () => {
  it("offers slots for clear booking intent without asking for personal data first", async () => {
    const repos = new InMemoryRepositories();
    const calendar = new FakeCalendar();
    const audit = new InMemoryAuditLog();
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
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const workflow = new ConversationWorkflow(
      repos,
      new SchedulingService(repos, calendar, audit),
      audit
    );

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Tengo este horario");
    expect(result.text).not.toContain("DNI");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/conversation-workflow.test.ts
```

Expected: FAIL because conversation workflow files do not exist.

- [ ] **Step 3: Add intent model**

Create `src/application/conversations/intent.ts` with this content:

```ts
export type ConversationIntent =
  | { type: "book"; serviceName: string }
  | { type: "reschedule" }
  | { type: "cancel" }
  | { type: "handoff"; reason: string }
  | { type: "question"; topic: string };

export function interpretIntent(text: string): ConversationIntent {
  const normalized = text.toLowerCase();

  if (normalized.includes("humano") || normalized.includes("persona")) {
    return { type: "handoff", reason: "patient_requested_human" };
  }

  if (normalized.includes("cancel")) {
    return { type: "cancel" };
  }

  if (normalized.includes("reprogram") || normalized.includes("cambiar turno") || normalized.includes("mover turno")) {
    return { type: "reschedule" };
  }

  if (normalized.includes("reserv") || normalized.includes("turno")) {
    if (normalized.includes("botox")) {
      return { type: "book", serviceName: "Botox" };
    }
    return { type: "book", serviceName: "" };
  }

  return { type: "question", topic: text };
}
```

- [ ] **Step 4: Add conversation workflow**

Create `src/application/conversations/conversation-workflow.ts` with this content:

```ts
import type { InMemoryRepositories } from "../../adapters/memory/repositories.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { SchedulingService } from "../scheduling/scheduling-service.js";
import { interpretIntent } from "./intent.js";

type InboundMessage = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
};

export type WorkflowResult =
  | { kind: "reply"; text: string }
  | { kind: "handoff"; text: string };

export class ConversationWorkflow {
  constructor(
    private readonly repos: InMemoryRepositories,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditLogPort
  ) {}

  async handleInboundMessage(input: InboundMessage): Promise<WorkflowResult> {
    this.repos.upsertPatient({ id: input.patientId, whatsappNumber: input.whatsappNumber });
    this.repos.saveConversation({
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      botPaused: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const intent = interpretIntent(input.text);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "intent.detected",
      message: `Detected ${intent.type}`,
      metadata: { intent: intent.type }
    });

    if (intent.type === "handoff") {
      const conversation = this.repos.getConversation(input.conversationId);
      if (conversation) {
        this.repos.saveConversation({ ...conversation, botPaused: true, updatedAt: new Date() });
      }
      return { kind: "handoff", text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat." };
    }

    if (intent.type === "book") {
      const profile = this.repos.getClinicProfile(input.clinicId);
      const service = profile?.services.find((candidate) =>
        candidate.name.toLowerCase() === intent.serviceName.toLowerCase()
      );

      if (!profile || !service) {
        return { kind: "reply", text: "Decime que tratamiento queres reservar y te ayudo con los horarios." };
      }

      const slots = await this.scheduling.findSlots({
        clinicId: input.clinicId,
        serviceId: service.id,
        from: new Date("2026-06-01T00:00:00.000Z"),
        to: new Date("2026-06-08T00:00:00.000Z")
      });

      if (slots.length === 0) {
        return {
          kind: "reply",
          text: "No encontre horarios disponibles para ese tratamiento. Te aviso si se libera un turno."
        };
      }

      const first = slots[0];
      return {
        kind: "reply",
        text: `Tengo este horario: ${first.startsAt.toISOString()} con disponibilidad para ${service.name}. Si te sirve, lo confirmamos.`
      };
    }

    if (intent.type === "cancel") {
      return { kind: "reply", text: "Pasame cual turno queres cancelar y lo reviso." };
    }

    if (intent.type === "reschedule") {
      return { kind: "reply", text: "Pasame cual turno queres cambiar y busco opciones." };
    }

    return { kind: "reply", text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa." };
  }
}
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm test -- tests/conversation-workflow.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/application/conversations/intent.ts src/application/conversations/conversation-workflow.ts tests/conversation-workflow.test.ts
git commit -m "feat: add conversation workflow"
```

Expected: commit succeeds.

## Task 7: Add Outbound Policies For Reminders, Reactivation, And Freed Slots

**Files:**
- Create: `src/application/outbound/reminder-policy.ts`
- Create: `src/application/outbound/reactivation-policy.ts`
- Create: `src/application/outbound/freed-slot-service.ts`
- Test: `tests/outbound-policies.test.ts`

- [ ] **Step 1: Write failing outbound tests**

Create `tests/outbound-policies.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { shouldSendReminder } from "../src/application/outbound/reminder-policy.js";
import { canReactivate } from "../src/application/outbound/reactivation-policy.js";
import { matchFreedSlot } from "../src/application/outbound/freed-slot-service.js";

describe("outbound policies", () => {
  it("sends 72h and 24h reminders, plus same-day only for high-risk appointments", () => {
    const appointmentTime = new Date("2026-06-10T15:00:00.000Z");

    expect(shouldSendReminder({ now: new Date("2026-06-07T15:00:00.000Z"), appointmentTime })).toBe("72h");
    expect(shouldSendReminder({ now: new Date("2026-06-09T15:00:00.000Z"), appointmentTime })).toBe("24h");
    expect(
      shouldSendReminder({
        now: new Date("2026-06-10T12:00:00.000Z"),
        appointmentTime,
        sameDayRisk: true
      })
    ).toBe("same-day");
  });

  it("reactivates only prior contacts who did not opt out", () => {
    expect(canReactivate({ hadPriorConversation: true, optedOut: false, previousAttempts: 0 })).toBe(true);
    expect(canReactivate({ hadPriorConversation: false, optedOut: false, previousAttempts: 0 })).toBe(false);
    expect(canReactivate({ hadPriorConversation: true, optedOut: true, previousAttempts: 0 })).toBe(false);
    expect(canReactivate({ hadPriorConversation: true, optedOut: false, previousAttempts: 2 })).toBe(false);
  });

  it("matches freed slots to compatible active interests", () => {
    const match = matchFreedSlot({
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      interests: [
        {
          id: "interest_1",
          clinicId: "clinic_1",
          patientId: "pat_1",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        }
      ]
    });

    expect(match?.id).toBe("interest_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/outbound-policies.test.ts
```

Expected: FAIL because outbound policy files do not exist.

- [ ] **Step 3: Add reminder policy**

Create `src/application/outbound/reminder-policy.ts` with this content:

```ts
type ReminderInput = {
  now: Date;
  appointmentTime: Date;
  sameDayRisk?: boolean;
};

export type ReminderKind = "72h" | "24h" | "same-day" | "none";

export function shouldSendReminder(input: ReminderInput): ReminderKind {
  const diffHours = Math.round((input.appointmentTime.getTime() - input.now.getTime()) / 3600000);

  if (diffHours === 72) {
    return "72h";
  }

  if (diffHours === 24) {
    return "24h";
  }

  if (input.sameDayRisk && diffHours >= 2 && diffHours <= 3) {
    return "same-day";
  }

  return "none";
}
```

- [ ] **Step 4: Add reactivation policy**

Create `src/application/outbound/reactivation-policy.ts` with this content:

```ts
type ReactivationInput = {
  hadPriorConversation: boolean;
  optedOut: boolean;
  previousAttempts: number;
};

export function canReactivate(input: ReactivationInput) {
  if (!input.hadPriorConversation) {
    return false;
  }

  if (input.optedOut) {
    return false;
  }

  return input.previousAttempts < 2;
}

export function isOptOutText(text: string) {
  const normalized = text.toLowerCase();
  return ["no me escriban mas", "no me escriban más", "baja", "stop", "no quiero"].some((phrase) =>
    normalized.includes(phrase)
  );
}
```

- [ ] **Step 5: Add freed-slot matcher**

Create `src/application/outbound/freed-slot-service.ts` with this content:

```ts
import type { PatientInterest } from "../../adapters/memory/repositories.js";
import type { TimeSlot } from "../../domain/types.js";

type MatchFreedSlotInput = {
  slot: TimeSlot;
  interests: PatientInterest[];
};

export function matchFreedSlot(input: MatchFreedSlotInput) {
  return input.interests.find((interest) => {
    const active = interest.status === "active";
    const professionalMatches = interest.professionalId ? interest.professionalId === input.slot.professionalId : true;
    const insidePreference =
      input.slot.startsAt >= interest.preferredFrom && input.slot.endsAt <= interest.preferredTo;

    return active && professionalMatches && insidePreference;
  });
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test -- tests/outbound-policies.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/application/outbound/reminder-policy.ts src/application/outbound/reactivation-policy.ts src/application/outbound/freed-slot-service.ts tests/outbound-policies.test.ts
git commit -m "feat: add outbound appointment policies"
```

Expected: commit succeeds.

## Task 8: Add Local Simulation API

**Files:**
- Create: `src/api/routes.ts`
- Create: `src/dev/seed.ts`
- Modify: `src/api/app.ts`
- Test: `tests/simulation-api.test.ts`

- [ ] **Step 1: Write failing API test**

Create `tests/simulation-api.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";

describe("local simulation API", () => {
  it("handles a simulated inbound WhatsApp booking message", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1",
        conversationId: "conv_1",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: "reply",
      text: expect.stringContaining("Tengo este horario")
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/simulation-api.test.ts
```

Expected: FAIL because `/simulate/inbound-message` is not registered.

- [ ] **Step 3: Add seed setup**

Create `src/dev/seed.ts` with this content:

```ts
import { InMemoryAuditLog } from "../adapters/memory/audit-log.js";
import { FakeCalendar } from "../adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../adapters/memory/repositories.js";
import { ConversationWorkflow } from "../application/conversations/conversation-workflow.js";
import { SchedulingService } from "../application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../domain/clinic-profile.js";

export function buildDevContainer() {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();

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
          restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
    { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
  ]);

  const scheduling = new SchedulingService(repos, calendar, audit);
  const workflow = new ConversationWorkflow(repos, scheduling, audit);

  return { repos, calendar, audit, scheduling, workflow };
}
```

- [ ] **Step 4: Add simulation routes**

Create `src/api/routes.ts` with this content:

```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildDevContainer } from "../dev/seed.js";

const inboundMessageSchema = z.object({
  clinicId: z.string(),
  conversationId: z.string(),
  patientId: z.string(),
  whatsappNumber: z.string(),
  text: z.string()
});

export function registerRoutes(app: FastifyInstance) {
  const container = buildDevContainer();

  app.post("/simulate/inbound-message", async (request, reply) => {
    const input = inboundMessageSchema.parse(request.body);
    const result = await container.workflow.handleInboundMessage(input);
    return reply.send(result);
  });

  app.get("/simulate/audit-log", async () => {
    return container.audit.list();
  });
}
```

- [ ] **Step 5: Register routes in app**

Replace `src/api/app.ts` with this content:

```ts
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  registerRoutes(app);

  return app;
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test -- tests/simulation-api.test.ts tests/health.test.ts
npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/api/routes.ts src/dev/seed.ts src/api/app.ts tests/simulation-api.test.ts
git commit -m "feat: add local simulation api"
```

Expected: commit succeeds.

## Task 9: Add Prisma Schema For Persistent MVP Data

**Files:**
- Create: `prisma/schema.prisma`
- Create: `.env.example`
- Test: `prisma/schema.prisma`

- [ ] **Step 1: Create Prisma schema**

Create `prisma/schema.prisma` with this content:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Clinic {
  id                         String   @id
  name                       String
  timezone                   String
  minimumNoticeMinutes       Int
  cancellationNoticeMinutes  Int
  bufferMinutes              Int
  requiredPatientFieldsJson  String
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
  services                   Service[]
  professionals              Professional[]
}

model Service {
  id                   String @id
  clinicId             String
  name                 String
  durationMinutes      Int
  priceText            String
  preparation          String
  restrictionsJson     String
  clinic               Clinic @relation(fields: [clinicId], references: [id])
  serviceProfessionals ServiceProfessional[]
}

model Professional {
  id                   String @id
  clinicId             String
  name                 String
  calendarId           String
  clinic               Clinic @relation(fields: [clinicId], references: [id])
  serviceProfessionals ServiceProfessional[]
}

model ServiceProfessional {
  serviceId      String
  professionalId String
  service        Service      @relation(fields: [serviceId], references: [id])
  professional   Professional @relation(fields: [professionalId], references: [id])

  @@id([serviceId, professionalId])
}

model Patient {
  id             String   @id
  whatsappNumber String   @unique
  fullName       String?
  optedOut       Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Appointment {
  id              String   @id
  clinicId        String
  patientId       String
  serviceId       String
  professionalId  String
  calendarEventId String
  startsAt        DateTime
  endsAt          DateTime
  status          String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Conversation {
  id        String   @id
  clinicId  String
  patientId String
  botPaused Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model PatientInterest {
  id             String   @id
  clinicId       String
  patientId      String
  serviceId      String
  professionalId String?
  preferredFrom  DateTime
  preferredTo    DateTime
  status         String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model AuditEvent {
  id             String   @id
  clinicId       String
  conversationId String?
  type           String
  message        String
  metadataJson   String
  createdAt      DateTime @default(now())
}
```

- [ ] **Step 2: Create env example**

Create `.env.example` with this content:

```bash
DATABASE_URL="file:./dev.db"
PORT=3000
HOST=127.0.0.1
OPENAI_API_KEY=""
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
cp .env.example .env
npm run prisma:generate
```

Expected: Prisma Client is generated without schema errors.

- [ ] **Step 4: Run migration**

Run:

```bash
npm run prisma:migrate -- --name init
```

Expected: Prisma creates `prisma/migrations/*_init/migration.sql` and local `prisma/dev.db`.

- [ ] **Step 5: Run verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: typecheck and all tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add prisma/schema.prisma prisma/migrations .env.example package.json package-lock.json
git commit -m "feat: add persistence schema"
```

Expected: commit succeeds. Do not commit `.env` or `prisma/dev.db`.

## Task 10: Final Local Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document local commands**

Append this section to `README.md`:

````markdown
## Local Development

Install dependencies:

```bash
npm install
```

Create local environment:

```bash
cp .env.example .env
```

Run tests:

```bash
npm test
npm run typecheck
```

Start local API:

```bash
npm run dev
```

Simulate an inbound WhatsApp message:

```bash
curl -sS -X POST http://127.0.0.1:3000/simulate/inbound-message \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","conversationId":"conv_1","patientId":"pat_1","whatsappNumber":"+5491111111111","text":"Quiero reservar botox"}'
```
````

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: all tests pass and typecheck exits with code 0.

- [ ] **Step 3: Start local API**

Run:

```bash
npm run dev
```

Expected: server logs `Momentum API listening on http://127.0.0.1:3000`.

- [ ] **Step 4: Smoke test API from another terminal**

Run:

```bash
curl -sS http://127.0.0.1:3000/health
```

Expected:

```json
{"status":"ok"}
```

Run:

```bash
curl -sS -X POST http://127.0.0.1:3000/simulate/inbound-message \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","conversationId":"conv_1","patientId":"pat_1","whatsappNumber":"+5491111111111","text":"Quiero reservar botox"}'
```

Expected response contains:

```json
{"kind":"reply","text":"Tengo este horario: 2026-06-01T13:00:00.000Z con disponibilidad para Botox. Si te sirve, lo confirmamos."}
```

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md
git commit -m "docs: add local development commands"
```

Expected: commit succeeds.

## Plan Self-Review

Spec coverage:
- WhatsApp conversation handling is represented by local simulation endpoints and conversation workflow.
- Booking, rescheduling, and cancellation are covered by scheduling service methods and conversation workflow entry points.
- Multi-professional calendar model is covered by clinic profile and calendar filtering.
- Calendar source of truth is covered by the `CalendarPort`.
- Audit trail is covered by `AuditLogPort` and in-memory implementation.
- Reactivation, opt-out, reminders, and freed-slot matching are covered by outbound policies.
- Human handoff is represented by bot pause state in conversation workflow.

Known scope outside this first plan:
- Real WhatsApp provider.
- Real Google Calendar connector.
- Real Outlook connector.
- OpenAI-powered intent interpreter.
- Production queue/cron execution for outbound jobs.
- Deployment.

These are separate subsystems and should each get their own Superpowers implementation plan after this foundation is working.
