# Live Pilot Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Momentum deployable as a real 24/7 pilot with managed Postgres, Vercel Functions/Cron, production safety gates, operational pause controls, logs, and a runbook.

**Architecture:** Keep the current Fastify application as the core backend and add production runtime wrappers around it. Preserve SQLite for local tests, add a separate Postgres Prisma schema for production builds/migrations, deploy the API as Vercel Node functions from the repo root, deploy the web app as a separate Vercel project rooted at `apps/web`, and keep production automation behind explicit activation and auth gates.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Prisma, SQLite local, Postgres production, Vercel Functions, Vercel Cron, Vitest, Next.js App Router.

---

## Scope Check

This plan implements the production-readiness block only:

- production env safety;
- Postgres production schema/scripts;
- Vercel function entrypoint for the Fastify API;
- Vercel web deployment remains rooted at `apps/web` and talks to the API through the existing `/api/backend` proxy using `MOMENTUM_API_BASE_URL`;
- protected Vercel Cron endpoint for outbound automation;
- minimum production logging/audit for ignored or failed production paths;
- internal pause/resume controls for handoff operations;
- runbook and smoke checklist.

It does not implement Outlook, payments, analytics dashboards, the internal staff WhatsApp agent, direct Meta Cloud API, or a customer-facing dashboard.

## File Structure

- Create `src/config/runtime-environment.ts`: production mode detection, database URL safety, simulation safety, and redacted runtime summary.
- Modify `src/server.ts`: delegate runtime construction to a reusable production runtime builder.
- Create `src/runtime/production-app.ts`: builds Fastify app plus Prisma/runtime dependencies without calling `listen()`.
- Create `src/runtime/vercel-fastify-handler.ts`: adapts the Fastify app to Vercel Node request/response handlers and strips `/api`.
- Create `api/[...path].ts`: catch-all Vercel function for backend routes.
- Create `src/runtime/outbound-cron.ts`: shared protected cron runner that calls the internal outbound automation route.
- Create `api/cron/outbound.ts`: Vercel Cron function entrypoint.
- Create `vercel.json`: API-project rewrites for public backend paths to the catch-all API function and schedules outbound cron.
- Create `prisma/schema.postgres.prisma`: Postgres production schema matching the current Prisma model.
- Create `prisma/postgres/migrations/20260531090000_init/migration.sql`: Postgres baseline migration generated from `schema.postgres.prisma`.
- Modify `package.json`: add production Prisma and build scripts.
- Modify `.env.example`: add production env names and separate cron/runtime vars.
- Create `src/ports/logger.ts`: small structured logging port.
- Create `src/adapters/console-logger.ts`: JSON console logger.
- Modify `src/api/app.ts`, `src/api/whatsapp-routes.ts`, and `src/api/outbound-routes.ts`: accept optional logger/audit and log/audit ignored production requests.
- Create `src/application/conversations/conversation-control-service.ts`: internal pause/resume service for existing conversations.
- Create `src/api/conversation-control-routes.ts`: admin-protected pause/resume routes.
- Modify `src/runtime/server-runtime.ts`: expose operational repository, audit log, and conversation-control service for production wiring.
- Create `docs/runbooks/live-pilot.md`: production deploy, activation, smoke test, and emergency pause runbook.
- Modify `README.md` and `docs/superpowers/README.md`: point to current product status and the pilot runbook.
- Add focused tests listed in each task.

## Task 1: Add Production Runtime Safety Config

**Files:**
- Create: `src/config/runtime-environment.ts`
- Modify: `src/server.ts`
- Test: `tests/runtime-environment.test.ts`
- Test: `tests/server-runtime.test.ts`

- [ ] **Step 1: Write failing runtime safety tests**

Create `tests/runtime-environment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertRuntimeSafety,
  buildRuntimeSummary,
  readRuntimeMode
} from "../src/config/runtime-environment.js";

describe("runtime environment safety", () => {
  it("treats Vercel production as production runtime", () => {
    expect(readRuntimeMode({ VERCEL_ENV: "production" })).toBe("production");
    expect(readRuntimeMode({ NODE_ENV: "production" })).toBe("production");
    expect(readRuntimeMode({ MOMENTUM_RUNTIME_ENV: "production" })).toBe("production");
  });

  it("allows local SQLite in development", () => {
    expect(() =>
      assertRuntimeSafety({
        runtimeMode: "development",
        databaseUrl: "file:./dev.db",
        enableSimulationApi: true,
        calendarProvider: "fake",
        whatsappProvider: "disabled",
        outboundAutomationEnabled: false,
        adminEnabled: true
      })
    ).not.toThrow();
  });

  it("rejects SQLite in production", () => {
    expect(() =>
      assertRuntimeSafety({
        runtimeMode: "production",
        databaseUrl: "file:./dev.db",
        enableSimulationApi: false,
        calendarProvider: "google",
        whatsappProvider: "kapso",
        outboundAutomationEnabled: true,
        adminEnabled: true,
        publicWebhookUrl: "https://momentum.example.com"
      })
    ).toThrow("Production requires a Postgres DATABASE_URL");
  });

  it("rejects simulation API in production", () => {
    expect(() =>
      assertRuntimeSafety({
        runtimeMode: "production",
        databaseUrl: "postgresql://user:pass@db.example.com:5432/momentum",
        enableSimulationApi: true,
        calendarProvider: "google",
        whatsappProvider: "kapso",
        outboundAutomationEnabled: true,
        adminEnabled: true,
        publicWebhookUrl: "https://momentum.example.com"
      })
    ).toThrow("ENABLE_SIMULATION_API must be false in production");
  });

  it("rejects Kapso production without a public webhook URL", () => {
    expect(() =>
      assertRuntimeSafety({
        runtimeMode: "production",
        databaseUrl: "postgresql://user:pass@db.example.com:5432/momentum",
        enableSimulationApi: false,
        calendarProvider: "google",
        whatsappProvider: "kapso",
        outboundAutomationEnabled: true,
        adminEnabled: true,
        publicWebhookUrl: ""
      })
    ).toThrow("MOMENTUM_PUBLIC_WEBHOOK_URL is required when WHATSAPP_PROVIDER=kapso in production");
  });

  it("builds a redacted startup summary", () => {
    expect(
      buildRuntimeSummary({
        runtimeMode: "production",
        databaseUrl: "postgresql://user:secret@db.example.com:5432/momentum",
        enableSimulationApi: false,
        calendarProvider: "google",
        whatsappProvider: "kapso",
        outboundAutomationEnabled: true,
        adminEnabled: true,
        publicWebhookUrl: "https://momentum.example.com"
      })
    ).toEqual({
      runtimeMode: "production",
      database: "postgres",
      simulationApi: "disabled",
      calendarProvider: "google",
      whatsappProvider: "kapso",
      outboundAutomation: "enabled",
      adminRoutes: "enabled",
      publicWebhookUrlConfigured: true
    });
  });
});
```

Add this test to `tests/server-runtime.test.ts` inside the existing `describe` block named `server startup runtime decisions`:

```ts
it("requires onboarding runtime when Kapso is enabled even without outbound automation", () => {
  expect(
    needsOnboardingRuntime({
      adminEnabled: false,
      whatsappProvider: "kapso",
      outboundAutomationEnabled: false
    })
  ).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/runtime-environment.test.ts tests/server-runtime.test.ts
```

Expected: FAIL because `src/config/runtime-environment.ts` does not exist.

- [ ] **Step 3: Implement runtime safety config**

Create `src/config/runtime-environment.ts`:

```ts
import type { CalendarProvider } from "../dev/seed.js";
import type { WhatsAppConfig } from "./whatsapp.js";

export type RuntimeMode = "development" | "production";

export type RuntimeSafetyInput = {
  runtimeMode: RuntimeMode;
  databaseUrl?: string;
  enableSimulationApi: boolean;
  calendarProvider: CalendarProvider;
  whatsappProvider: WhatsAppConfig["provider"];
  outboundAutomationEnabled: boolean;
  adminEnabled: boolean;
  publicWebhookUrl?: string;
};

export type RuntimeSummary = {
  runtimeMode: RuntimeMode;
  database: "missing" | "sqlite" | "postgres" | "other";
  simulationApi: "enabled" | "disabled";
  calendarProvider: CalendarProvider;
  whatsappProvider: WhatsAppConfig["provider"];
  outboundAutomation: "enabled" | "disabled";
  adminRoutes: "enabled" | "disabled";
  publicWebhookUrlConfigured: boolean;
};

export function readRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  if (
    env.MOMENTUM_RUNTIME_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production"
  ) {
    return "production";
  }
  return "development";
}

export function assertRuntimeSafety(input: RuntimeSafetyInput): void {
  if (input.runtimeMode !== "production") {
    return;
  }

  if (databaseKind(input.databaseUrl) !== "postgres") {
    throw new Error("Production requires a Postgres DATABASE_URL");
  }

  if (input.enableSimulationApi) {
    throw new Error("ENABLE_SIMULATION_API must be false in production");
  }

  if (input.whatsappProvider === "kapso" && !input.publicWebhookUrl?.trim()) {
    throw new Error("MOMENTUM_PUBLIC_WEBHOOK_URL is required when WHATSAPP_PROVIDER=kapso in production");
  }
}

export function buildRuntimeSummary(input: RuntimeSafetyInput): RuntimeSummary {
  return {
    runtimeMode: input.runtimeMode,
    database: databaseKind(input.databaseUrl),
    simulationApi: input.enableSimulationApi ? "enabled" : "disabled",
    calendarProvider: input.calendarProvider,
    whatsappProvider: input.whatsappProvider,
    outboundAutomation: input.outboundAutomationEnabled ? "enabled" : "disabled",
    adminRoutes: input.adminEnabled ? "enabled" : "disabled",
    publicWebhookUrlConfigured: Boolean(input.publicWebhookUrl?.trim())
  };
}

function databaseKind(databaseUrl: string | undefined): RuntimeSummary["database"] {
  if (!databaseUrl?.trim()) {
    return "missing";
  }
  if (databaseUrl.startsWith("file:")) {
    return "sqlite";
  }
  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    return "postgres";
  }
  return "other";
}
```

Update `needsOnboardingRuntime()` in `src/runtime/server-runtime.ts`:

```ts
export function needsOnboardingRuntime(input: {
  adminEnabled: boolean;
  whatsappProvider: WhatsAppConfig["provider"];
  outboundAutomationEnabled: boolean;
}) {
  return input.adminEnabled || input.whatsappProvider === "kapso";
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/runtime-environment.test.ts tests/server-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/runtime-environment.ts src/runtime/server-runtime.ts tests/runtime-environment.test.ts tests/server-runtime.test.ts
git commit -m "feat: add production runtime safety checks"
```

## Task 2: Add Postgres Production Prisma Schema And Scripts

**Files:**
- Create: `prisma/schema.postgres.prisma`
- Create: `prisma/postgres/migrations/20260531090000_init/migration.sql`
- Create: `prisma/postgres/migrations/migration_lock.toml`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Verify the Postgres schema does not exist yet**

Run:

```bash
npx prisma validate --schema prisma/schema.postgres.prisma
```

Expected: FAIL because `prisma/schema.postgres.prisma` does not exist.

- [ ] **Step 2: Create the Postgres schema from the current local schema**

Copy `prisma/schema.prisma` to `prisma/schema.postgres.prisma`, then change only the datasource provider:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Keep the generator and every model identical to `prisma/schema.prisma`.

- [ ] **Step 3: Add Postgres migration lock**

Create `prisma/postgres/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system.
provider = "postgresql"
```

- [ ] **Step 4: Generate the Postgres baseline migration**

Run:

```bash
mkdir -p prisma/postgres/migrations/20260531090000_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.postgres.prisma \
  --script > prisma/postgres/migrations/20260531090000_init/migration.sql
```

Expected: `prisma/postgres/migrations/20260531090000_init/migration.sql` contains `CREATE TABLE` statements using Postgres-compatible SQL.

- [ ] **Step 5: Add production Prisma scripts**

Modify `package.json` scripts:

```json
{
  "prisma:generate": "prisma generate",
  "prisma:generate:postgres": "prisma generate --schema prisma/schema.postgres.prisma",
  "prisma:validate:postgres": "prisma validate --schema prisma/schema.postgres.prisma",
  "prisma:migrate": "prisma migrate dev",
  "prisma:migrate:deploy:postgres": "prisma migrate deploy --schema prisma/schema.postgres.prisma",
  "build:api:production": "npm run prisma:generate:postgres && npm run typecheck",
  "build:web:production": "npm --workspace apps/web run build",
  "build:production": "npm run build:api:production && npm run build:web:production"
}
```

Preserve the existing scripts not shown here.

- [ ] **Step 6: Document production database env defaults**

Update `.env.example` so the top keeps local SQLite and adds production notes:

```bash
DATABASE_URL="file:./dev.db"
# Production uses managed Postgres, for example:
# DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
MOMENTUM_RUNTIME_ENV="development"
CRON_SECRET=""
MOMENTUM_CRON_CLINIC_ID=""
```

- [ ] **Step 7: Validate both schemas and restore local client generation**

Run:

```bash
npx prisma validate
npm run prisma:validate:postgres
npm run prisma:generate:postgres
npm run prisma:generate
```

Expected: all commands exit 0. The final `npm run prisma:generate` restores the default SQLite-generated local client for the test suite.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example prisma/schema.postgres.prisma prisma/postgres/migrations
git commit -m "feat: add postgres production prisma schema"
```

## Task 3: Add Production App Runtime And Vercel Fastify Handler

**Files:**
- Create: `src/runtime/production-app.ts`
- Create: `src/runtime/vercel-fastify-handler.ts`
- Create: `api/[...path].ts`
- Modify: `src/server.ts`
- Test: `tests/vercel-fastify-handler.test.ts`
- Test: `tests/production-app-runtime.test.ts`

- [ ] **Step 1: Write failing Vercel handler path tests**

Create `tests/vercel-fastify-handler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripVercelApiPrefix } from "../src/runtime/vercel-fastify-handler.js";

describe("Vercel Fastify handler", () => {
  it.each([
    ["/api/health", "/health"],
    ["/api/webhooks/whatsapp/kapso", "/webhooks/whatsapp/kapso"],
    ["/api/internal/outbound/run?x=1", "/internal/outbound/run?x=1"],
    ["/health", "/health"],
    [undefined, undefined]
  ])("strips only the leading /api prefix from %s", (input, expected) => {
    expect(stripVercelApiPrefix(input)).toBe(expected);
  });
});
```

Create `tests/production-app-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProductionAppRuntime } from "../src/runtime/production-app.js";

describe("production app runtime", () => {
  it("builds a local runtime without listening on a port", async () => {
    const runtime = await createProductionAppRuntime({
      ...process.env,
      DATABASE_URL: "file:./dev.db",
      CALENDAR_PROVIDER: "fake",
      WHATSAPP_PROVIDER: "",
      MOMENTUM_ADMIN_TOKEN: "",
      OUTBOUND_AUTOMATION_TOKEN: "",
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "development"
    });

    const response = await runtime.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(runtime.summary).toMatchObject({
      runtimeMode: "development",
      database: "sqlite",
      simulationApi: "disabled",
      calendarProvider: "fake",
      whatsappProvider: "disabled"
    });

    await runtime.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/vercel-fastify-handler.test.ts tests/production-app-runtime.test.ts
```

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 3: Create production runtime builder**

Create `src/runtime/production-app.ts` by moving the runtime construction from `src/server.ts` into this exported function:

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { PrismaOnboardingRepository } from "../adapters/prisma/onboarding-repository.js";
import { PrismaOperationalRepository } from "../adapters/prisma/operational-repository.js";
import { buildApp } from "../api/app.js";
import { GoogleCalendarOnboardingService } from "../application/onboarding/google-calendar-onboarding-service.js";
import { OnboardingService } from "../application/onboarding/onboarding-service.js";
import { readAdminConfig } from "../config/admin.js";
import { readOutboundConfig } from "../config/outbound.js";
import {
  assertRuntimeSafety,
  buildRuntimeSummary,
  readRuntimeMode,
  type RuntimeSummary
} from "../config/runtime-environment.js";
import { readWhatsAppConfig } from "../config/whatsapp.js";
import type { CalendarProvider } from "../dev/seed.js";
import {
  buildGoogleCalendarRuntime,
  buildWhatsAppRuntime,
  needsOnboardingRuntime,
  readRuntimeClinicId
} from "./server-runtime.js";

export type ProductionAppRuntime = {
  app: FastifyInstance;
  prisma?: PrismaClient;
  summary: RuntimeSummary;
  close(): Promise<void>;
};

export async function createProductionAppRuntime(
  env: NodeJS.ProcessEnv = process.env
): Promise<ProductionAppRuntime> {
  const runtimeMode = readRuntimeMode(env);
  const calendarProvider = readCalendarProvider(env.CALENDAR_PROVIDER);
  const whatsappConfig = readWhatsAppConfig(env);
  const outboundConfig = readOutboundConfig(env);
  const adminConfig = readAdminConfig(env);
  const enableSimulationRoutes = env.ENABLE_SIMULATION_API === "true";
  const onboardingRuntimeNeeded = needsOnboardingRuntime({
    adminEnabled: adminConfig.enabled,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled
  });

  assertRuntimeSafety({
    runtimeMode,
    databaseUrl: env.DATABASE_URL,
    enableSimulationApi: enableSimulationRoutes,
    calendarProvider,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled,
    adminEnabled: adminConfig.enabled,
    publicWebhookUrl: whatsappConfig.provider === "kapso" ? whatsappConfig.publicWebhookUrl : undefined
  });

  const summary = buildRuntimeSummary({
    runtimeMode,
    databaseUrl: env.DATABASE_URL,
    enableSimulationApi: enableSimulationRoutes,
    calendarProvider,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled,
    adminEnabled: adminConfig.enabled,
    publicWebhookUrl: whatsappConfig.provider === "kapso" ? whatsappConfig.publicWebhookUrl : undefined
  });

  const sharedPrisma =
    calendarProvider === "google" || onboardingRuntimeNeeded
      ? new PrismaClient()
      : undefined;
  const googleRuntime =
    calendarProvider === "google"
      ? await buildGoogleCalendarRuntime({ prisma: requirePrisma(sharedPrisma), env })
      : undefined;
  const onboardingService = onboardingRuntimeNeeded
    ? new OnboardingService({
        onboarding: new PrismaOnboardingRepository(requirePrisma(sharedPrisma)),
        operational: new PrismaOperationalRepository(requirePrisma(sharedPrisma)),
        calendarCredentials: googleRuntime?.credentialRepository,
        calendarRequiredScopes: googleRuntime?.config.scopes,
        calendarClientFactory: googleRuntime?.createCalendarClient
      })
    : undefined;
  const googleCalendarOnboardingService =
    adminConfig.enabled && googleRuntime
      ? new GoogleCalendarOnboardingService({
          credentials: googleRuntime.credentialRepository,
          requiredScopes: googleRuntime.config.scopes,
          oauthService: googleRuntime.oauthService,
          calendarClientFactory: googleRuntime.createCalendarClient
        })
      : undefined;
  const clinicActivation = onboardingService
    ? { isClinicActive: (clinicId: string) => onboardingService.isClinicActive(clinicId) }
    : undefined;
  const whatsappRuntime =
    whatsappConfig.provider === "kapso"
      ? await buildWhatsAppRuntime({
          prisma: requirePrisma(sharedPrisma),
          config: whatsappConfig,
          calendarProvider,
          calendar: googleRuntime?.calendar,
          clinicId: readRuntimeClinicId(env),
          clinicActivation
        })
      : undefined;

  const app = buildApp({
    enableSimulationRoutes,
    calendarProvider,
    simulationCalendar: googleRuntime?.calendar,
    googleCalendarOAuthService: googleRuntime?.oauthService,
    googleCalendarSetupToken: googleRuntime?.setupToken,
    whatsappKapsoWebhook: whatsappRuntime?.webhook,
    clinicActivation,
    outboundAutomation:
      outboundConfig.enabled && whatsappRuntime
        ? { token: outboundConfig.token, service: whatsappRuntime.outboundAutomation }
        : undefined,
    onboarding:
      adminConfig.enabled && onboardingService
        ? { adminToken: adminConfig.token, service: onboardingService }
        : undefined,
    googleCalendarOnboarding:
      adminConfig.enabled && googleCalendarOnboardingService
        ? { adminToken: adminConfig.token, service: googleCalendarOnboardingService }
        : undefined
  });

  return {
    app,
    prisma: sharedPrisma,
    summary,
    close: async () => {
      await app.close();
      await sharedPrisma?.$disconnect();
    }
  };
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error("Prisma runtime was not initialized");
  }
  return prisma;
}

function readCalendarProvider(provider: string | undefined): CalendarProvider {
  if (!provider || provider === "fake") {
    return "fake";
  }
  if (provider === "google") {
    return "google";
  }
  throw new Error(`Unsupported CALENDAR_PROVIDER: ${provider}`);
}
```

- [ ] **Step 4: Make `src/server.ts` listen through the runtime builder**

Replace `src/server.ts` with:

```ts
import "dotenv/config";
import { createProductionAppRuntime } from "./runtime/production-app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const runtime = await createProductionAppRuntime(process.env);

await runtime.app.listen({ port, host });
console.log(JSON.stringify({ event: "momentum.startup", ...runtime.summary }));
console.log(`Momentum API listening on http://${host}:${port}`);

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  await runtime.close();
  process.exit(0);
}
```

- [ ] **Step 5: Add Vercel Fastify handler utility**

Create `src/runtime/vercel-fastify-handler.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProductionAppRuntime } from "./production-app.js";

export type VercelRuntimeFactory = () => Promise<ProductionAppRuntime>;

export function createVercelFastifyHandler(runtimeFactory: VercelRuntimeFactory) {
  let runtimePromise: Promise<ProductionAppRuntime> | undefined;

  return async function handler(request: IncomingMessage, response: ServerResponse) {
    runtimePromise ??= runtimeFactory();
    const runtime = await runtimePromise;
    request.url = stripVercelApiPrefix(request.url);
    await runtime.app.ready();
    runtime.app.server.emit("request", request, response);
  };
}

export function stripVercelApiPrefix(url: string | undefined): string | undefined {
  if (!url?.startsWith("/api/")) {
    return url;
  }
  return url.slice("/api".length);
}
```

Create `api/[...path].ts`:

```ts
import { createProductionAppRuntime } from "../src/runtime/production-app.js";
import { createVercelFastifyHandler } from "../src/runtime/vercel-fastify-handler.js";

export const config = {
  maxDuration: 300
};

export default createVercelFastifyHandler(() => createProductionAppRuntime(process.env));
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/runtime-environment.test.ts tests/vercel-fastify-handler.test.ts tests/production-app-runtime.test.ts tests/health.test.ts tests/server-runtime.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/production-app.ts src/runtime/vercel-fastify-handler.ts src/server.ts 'api/[...path].ts' tests/vercel-fastify-handler.test.ts tests/production-app-runtime.test.ts
git commit -m "feat: add vercel fastify production runtime"
```

## Task 4: Add Protected Vercel Cron For Outbound Automation

**Files:**
- Create: `src/runtime/outbound-cron.ts`
- Create: `api/cron/outbound.ts`
- Create: `vercel.json`
- Test: `tests/outbound-cron.test.ts`

- [ ] **Step 1: Write failing cron runner tests**

Create `tests/outbound-cron.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runOutboundCron } from "../src/runtime/outbound-cron.js";

describe("outbound cron runner", () => {
  it("rejects requests without the Vercel cron secret", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: undefined,
      env: {
        CRON_SECRET: "cron-secret",
        OUTBOUND_AUTOMATION_TOKEN: "outbound-token",
        MOMENTUM_CRON_CLINIC_ID: "clinic_1"
      },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({ statusCode: 401, body: { error: "unauthorized" } });
    expect(runtime.injectCalls).toEqual([]);
  });

  it("requires an outbound token and clinic id after cron auth succeeds", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: "Bearer cron-secret",
      env: { CRON_SECRET: "cron-secret" },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({
      statusCode: 500,
      body: { error: "outbound_cron_not_configured" }
    });
    expect(runtime.injectCalls).toEqual([]);
  });

  it("calls the internal outbound route with the configured clinic id", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: "Bearer cron-secret",
      env: {
        CRON_SECRET: "cron-secret",
        OUTBOUND_AUTOMATION_TOKEN: "outbound-token",
        MOMENTUM_CRON_CLINIC_ID: "clinic_1"
      },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({
      statusCode: 200,
      body: {
        reminders: { sent: 0, blocked: 0, failed: 0, skipped: 0 },
        reactivations: { sent: 0, blocked: 0, failed: 0, skipped: 0 }
      }
    });
    expect(runtime.injectCalls).toEqual([
      {
        method: "POST",
        url: "/internal/outbound/run",
        headers: { authorization: "Bearer outbound-token" },
        payload: { clinicId: "clinic_1" }
      }
    ]);
  });
});

class FakeRuntime {
  readonly injectCalls: unknown[] = [];
  readonly app = {
    inject: async (input: unknown) => {
      this.injectCalls.push(input);
      return {
        statusCode: 200,
        json: () => ({
          reminders: { sent: 0, blocked: 0, failed: 0, skipped: 0 },
          reactivations: { sent: 0, blocked: 0, failed: 0, skipped: 0 }
        })
      };
    }
  };
}
```

- [ ] **Step 2: Run cron tests to verify they fail**

Run:

```bash
npm test -- tests/outbound-cron.test.ts
```

Expected: FAIL because `src/runtime/outbound-cron.ts` does not exist.

- [ ] **Step 3: Implement shared outbound cron runner**

Create `src/runtime/outbound-cron.ts`:

```ts
import type { ProductionAppRuntime } from "./production-app.js";

export type OutboundCronResult = {
  statusCode: number;
  body: unknown;
};

export type OutboundCronInput = {
  authorization: string | undefined;
  env: NodeJS.ProcessEnv;
  runtimeFactory: () => Promise<Pick<ProductionAppRuntime, "app">>;
};

export async function runOutboundCron(input: OutboundCronInput): Promise<OutboundCronResult> {
  if (!input.env.CRON_SECRET || input.authorization !== `Bearer ${input.env.CRON_SECRET}`) {
    return { statusCode: 401, body: { error: "unauthorized" } };
  }

  const outboundToken = input.env.OUTBOUND_AUTOMATION_TOKEN?.trim();
  const clinicId = input.env.MOMENTUM_CRON_CLINIC_ID?.trim();
  if (!outboundToken || !clinicId) {
    return { statusCode: 500, body: { error: "outbound_cron_not_configured" } };
  }

  const runtime = await input.runtimeFactory();
  const response = await runtime.app.inject({
    method: "POST",
    url: "/internal/outbound/run",
    headers: { authorization: `Bearer ${outboundToken}` },
    payload: { clinicId }
  });

  return { statusCode: response.statusCode, body: response.json() as unknown };
}
```

- [ ] **Step 4: Add Vercel cron entrypoint**

Create `api/cron/outbound.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { createProductionAppRuntime } from "../../src/runtime/production-app.js";
import { runOutboundCron } from "../../src/runtime/outbound-cron.js";

export const config = {
  maxDuration: 300
};

let runtimePromise: ReturnType<typeof createProductionAppRuntime> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const result = await runOutboundCron({
    authorization: readHeader(request.headers.authorization),
    env: process.env,
    runtimeFactory: async () => {
      runtimePromise ??= createProductionAppRuntime(process.env);
      return runtimePromise;
    }
  });

  response.statusCode = result.statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(result.body));
}

function readHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
```

- [ ] **Step 5: Add Vercel rewrites and cron schedule**

Create `vercel.json`:

```json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 300
    }
  },
  "rewrites": [
    { "source": "/health", "destination": "/api/health" },
    { "source": "/leads", "destination": "/api/leads" },
    { "source": "/internal/(.*)", "destination": "/api/internal/$1" },
    { "source": "/integrations/(.*)", "destination": "/api/integrations/$1" },
    { "source": "/webhooks/(.*)", "destination": "/api/webhooks/$1" }
  ],
  "crons": [
    {
      "path": "/api/cron/outbound",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

This schedule requires a Vercel plan that supports sub-daily cron frequency. The runbook in Task 7 must call that out.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/outbound-cron.test.ts tests/outbound-routes.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/outbound-cron.ts api/cron/outbound.ts vercel.json tests/outbound-cron.test.ts
git commit -m "feat: add protected outbound cron"
```

## Task 5: Add Production Logging And Audit For Ignored Automation

**Files:**
- Create: `src/ports/logger.ts`
- Create: `src/adapters/console-logger.ts`
- Modify: `src/api/app.ts`
- Modify: `src/api/whatsapp-routes.ts`
- Modify: `src/api/outbound-routes.ts`
- Modify: `src/runtime/production-app.ts`
- Modify: `src/runtime/server-runtime.ts`
- Test: `tests/activation-gates.test.ts`
- Test: `tests/kapso-webhook.test.ts`

- [ ] **Step 1: Add failing logging/audit assertions for inactive webhooks**

In `tests/activation-gates.test.ts`, update the inactive webhook test to pass fake audit and logger:

```ts
it("audits and logs production WhatsApp webhooks ignored for inactive clinics", async () => {
  const inboundService = new FakeInboundService();
  const audit = new FakeAuditLog();
  const logger = new FakeLogger();
  const app = buildApp({
    clinicActivation: { isClinicActive: () => false },
    logger,
    whatsappKapsoWebhook: {
      secret: "webhook_secret",
      phoneNumberClinicMap: { "123456789012345": "clinic_1" },
      inboundService: inboundService as unknown as WhatsAppInboundService,
      audit
    }
  });
  const rawBody = JSON.stringify(kapsoReceivedMessagePayload());

  const response = await app.inject({
    method: "POST",
    url: "/webhooks/whatsapp/kapso",
    headers: signedWebhookHeaders(rawBody),
    payload: rawBody
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ignored", reason: "clinic_inactive" });
  expect(inboundService.calls).toBe(0);
  expect(audit.events).toEqual([
    expect.objectContaining({
      clinicId: "clinic_1",
      type: "whatsapp.inbound.ignored_inactive"
    })
  ]);
  expect(logger.entries).toEqual([
    expect.objectContaining({
      level: "warn",
      event: "whatsapp.inbound.ignored_inactive",
      clinicId: "clinic_1"
    })
  ]);

  await app.close();
});
```

Add helper classes at the bottom of `tests/activation-gates.test.ts`:

```ts
class FakeAuditLog {
  readonly events: unknown[] = [];

  async record(input: unknown) {
    this.events.push(input);
    return { id: `audit_${this.events.length}`, createdAt: new Date("2026-06-02T12:00:00.000Z"), ...(input as object) };
  }
}

class FakeLogger {
  readonly entries: unknown[] = [];

  info(input: unknown) {
    this.entries.push({ level: "info", ...(input as object) });
  }

  warn(input: unknown) {
    this.entries.push({ level: "warn", ...(input as object) });
  }

  error(input: unknown) {
    this.entries.push({ level: "error", ...(input as object) });
  }
}
```

Update the inactive outbound route test in `tests/activation-gates.test.ts` to pass the same fake logger and assert the inactive run is logged:

```ts
it("logs internal outbound runs rejected for inactive clinics without calling automation", async () => {
  const service = new FakeOutboundAutomationService();
  const logger = new FakeLogger();
  const app = buildApp({
    logger,
    clinicActivation: { isClinicActive: () => false },
    outboundAutomation: { token: "secret", service }
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/outbound/run",
    headers: { authorization: "Bearer secret" },
    payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
  });

  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "clinic_inactive" });
  expect(service.calls).toEqual([]);
  expect(logger.entries).toEqual([
    expect.objectContaining({
      level: "warn",
      event: "outbound.run.rejected_inactive",
      clinicId: "clinic_1"
    })
  ]);

  await app.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/activation-gates.test.ts
```

Expected: FAIL because `buildApp` and WhatsApp route options do not accept logger/audit yet.

- [ ] **Step 3: Add logger port and console adapter**

Create `src/ports/logger.ts`:

```ts
export type LogMetadata = Record<string, string | number | boolean | undefined>;

export interface LoggerPort {
  info(metadata: LogMetadata): void;
  warn(metadata: LogMetadata): void;
  error(metadata: LogMetadata): void;
}
```

Create `src/adapters/console-logger.ts`:

```ts
import type { LoggerPort, LogMetadata } from "../ports/logger.js";

export class ConsoleLogger implements LoggerPort {
  info(metadata: LogMetadata): void {
    console.log(JSON.stringify({ level: "info", ...metadata }));
  }

  warn(metadata: LogMetadata): void {
    console.warn(JSON.stringify({ level: "warn", ...metadata }));
  }

  error(metadata: LogMetadata): void {
    console.error(JSON.stringify({ level: "error", ...metadata }));
  }
}
```

- [ ] **Step 4: Wire logger/audit into app and WhatsApp route**

Modify `src/api/app.ts`:

```ts
import type { LoggerPort } from "../ports/logger.js";

type BuildAppOptions = {
  // Keep the existing BuildAppOptions properties and add this field.
  logger?: LoggerPort;
};
```

When registering WhatsApp and outbound routes, pass `logger: options.logger`.

Modify `src/api/outbound-routes.ts` options:

```ts
import type { LoggerPort } from "../ports/logger.js";

export type OutboundAutomationRoutesOptions = {
  token: string;
  service: Pick<OutboundAutomationService, "runDueReminders" | "runDueReactivations">;
  activation?: ClinicActivationGuard;
  logger?: LoggerPort;
};
```

Before returning `clinic_inactive`:

```ts
if (options.activation && !(await options.activation.isClinicActive(input.clinicId))) {
  options.logger?.warn({
    event: "outbound.run.rejected_inactive",
    clinicId: input.clinicId
  });
  return reply.status(409).send({ error: "clinic_inactive" });
}
```

Modify `src/api/whatsapp-routes.ts` options:

```ts
import type { AuditLogPort } from "../ports/audit-log.js";
import type { LoggerPort } from "../ports/logger.js";

export type WhatsAppKapsoWebhookRoutesOptions = {
  secret: string;
  phoneNumberClinicMap: Record<string, string>;
  inboundService: WhatsAppInboundService;
  activation?: ClinicActivationGuard;
  audit?: AuditLogPort;
  logger?: LoggerPort;
};
```

Before returning inactive ignored response:

```ts
if (options.activation && !(await options.activation.isClinicActive(clinicId))) {
  options.logger?.warn({
    event: "whatsapp.inbound.ignored_inactive",
    clinicId,
    providerPhoneNumberId
  });
  await options.audit?.record({
    clinicId,
    type: "whatsapp.inbound.ignored_inactive",
    message: "Ignored WhatsApp inbound delivery because clinic is inactive",
    metadata: { providerPhoneNumberId }
  });
  return reply.send({ status: "ignored", reason: "clinic_inactive" });
}
```

Also log provider/calendar errors in the catch block:

```ts
options.logger?.error({
  event: "whatsapp.inbound.failed",
  clinicId,
  error: error instanceof Error ? error.message : "unknown"
});
```

- [ ] **Step 5: Expose audit/logger from runtime**

Modify `src/runtime/server-runtime.ts` in `buildWhatsAppRuntime()`:

```ts
return {
  outboundAutomation,
  audit,
  webhook: {
    secret: input.config.webhookSecret,
    phoneNumberClinicMap: { [input.config.phoneNumberId]: clinicId },
    inboundService: new WhatsAppInboundService({
      repos,
      provider,
      workflow,
      audit
    }),
    audit
  }
};
```

Modify `src/runtime/production-app.ts`:

```ts
import { ConsoleLogger } from "../adapters/console-logger.js";

const logger = new ConsoleLogger();

const app = buildApp({
  logger,
  // Keep the current buildApp options in this object.
  whatsappKapsoWebhook: whatsappRuntime?.webhook,
  // Keep the current onboarding and calendar options in this object.
});
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/activation-gates.test.ts tests/kapso-webhook.test.ts tests/server-runtime.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/ports/logger.ts src/adapters/console-logger.ts src/api/app.ts src/api/whatsapp-routes.ts src/runtime/server-runtime.ts src/runtime/production-app.ts tests/activation-gates.test.ts
git commit -m "feat: audit ignored production webhook traffic"
```

## Task 6: Add Internal Conversation Pause And Resume Controls

**Files:**
- Create: `src/application/conversations/conversation-control-service.ts`
- Create: `src/api/conversation-control-routes.ts`
- Modify: `src/api/app.ts`
- Modify: `src/runtime/production-app.ts`
- Test: `tests/conversation-control-service.test.ts`
- Test: `tests/conversation-control-routes.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/conversation-control-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { InMemoryOperationalRepository } from "../src/adapters/memory/repositories.js";
import { ConversationControlService } from "../src/application/conversations/conversation-control-service.js";

describe("ConversationControlService", () => {
  it("pauses and resumes an existing conversation with audit events", async () => {
    const repos = new InMemoryOperationalRepository();
    const audit = new InMemoryAuditLog();
    await repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "patient_1",
      botPaused: false,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    const service = new ConversationControlService({
      repos,
      audit,
      now: () => new Date("2026-06-01T12:05:00.000Z")
    });

    await service.pauseConversation({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      reason: "operator_handoff"
    });
    await expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).resolves.toMatchObject({
      botPaused: true,
      updatedAt: new Date("2026-06-01T12:05:00.000Z")
    });

    await service.resumeConversation({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      reason: "operator_resolved"
    });
    await expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).resolves.toMatchObject({
      botPaused: false
    });
    await expect(audit.list()).resolves.toEqual([
      expect.objectContaining({ type: "conversation.bot_paused" }),
      expect.objectContaining({ type: "conversation.bot_resumed" })
    ]);
  });

  it("throws when the conversation does not exist", async () => {
    const service = new ConversationControlService({
      repos: new InMemoryOperationalRepository(),
      audit: new InMemoryAuditLog()
    });

    await expect(
      service.pauseConversation({
        clinicId: "clinic_1",
        conversationId: "missing",
        reason: "operator_handoff"
      })
    ).rejects.toThrow("Conversation clinic_1:missing not found");
  });
});
```

- [ ] **Step 2: Write failing route tests**

Create `tests/conversation-control-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";

describe("conversation control routes", () => {
  it("requires admin auth", async () => {
    const app = buildApp({
      conversationControl: {
        adminToken: "secret",
        service: new FakeConversationControlService()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/pause",
      payload: { reason: "operator_handoff" }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("pauses and resumes conversations through internal routes", async () => {
    const service = new FakeConversationControlService();
    const app = buildApp({
      conversationControl: {
        adminToken: "secret",
        service
      }
    });

    const pause = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/pause",
      headers: { authorization: "Bearer secret" },
      payload: { reason: "operator_handoff" }
    });
    const resume = await app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/conversations/conv_1/resume",
      headers: { authorization: "Bearer secret" },
      payload: { reason: "operator_resolved" }
    });

    expect(pause.statusCode).toBe(200);
    expect(pause.json()).toEqual({ conversation: { id: "conv_1", clinicId: "clinic_1", botPaused: true } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toEqual({ conversation: { id: "conv_1", clinicId: "clinic_1", botPaused: false } });
    expect(service.calls).toEqual([
      "pause:clinic_1:conv_1:operator_handoff",
      "resume:clinic_1:conv_1:operator_resolved"
    ]);

    await app.close();
  });
});

class FakeConversationControlService {
  readonly calls: string[] = [];

  async pauseConversation(input: { clinicId: string; conversationId: string; reason: string }) {
    this.calls.push(`pause:${input.clinicId}:${input.conversationId}:${input.reason}`);
    return { id: input.conversationId, clinicId: input.clinicId, botPaused: true };
  }

  async resumeConversation(input: { clinicId: string; conversationId: string; reason: string }) {
    this.calls.push(`resume:${input.clinicId}:${input.conversationId}:${input.reason}`);
    return { id: input.conversationId, clinicId: input.clinicId, botPaused: false };
  }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/conversation-control-service.test.ts tests/conversation-control-routes.test.ts
```

Expected: FAIL because the service and routes do not exist.

- [ ] **Step 4: Implement conversation control service**

Create `src/application/conversations/conversation-control-service.ts`:

```ts
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { Conversation, OperationalRepository } from "../../ports/repositories.js";

export type ConversationControlInput = {
  clinicId: string;
  conversationId: string;
  reason: string;
};

export type ConversationControlServiceOptions = {
  repos: OperationalRepository;
  audit: AuditLogPort;
  now?: () => Date;
};

export class ConversationControlService {
  constructor(private readonly options: ConversationControlServiceOptions) {}

  async pauseConversation(input: ConversationControlInput): Promise<Conversation> {
    return this.setPaused(input, true, "conversation.bot_paused", "Paused bot for conversation");
  }

  async resumeConversation(input: ConversationControlInput): Promise<Conversation> {
    return this.setPaused(input, false, "conversation.bot_resumed", "Resumed bot for conversation");
  }

  private async setPaused(
    input: ConversationControlInput,
    botPaused: boolean,
    auditType: string,
    auditMessage: string
  ): Promise<Conversation> {
    const conversation = await this.options.repos.getConversation({
      clinicId: input.clinicId,
      conversationId: input.conversationId
    });
    if (!conversation) {
      throw new Error(`Conversation ${input.clinicId}:${input.conversationId} not found`);
    }

    const updated = {
      ...conversation,
      botPaused,
      updatedAt: this.options.now?.() ?? new Date()
    };
    await this.options.repos.saveConversation(updated);
    await this.options.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: auditType,
      message: auditMessage,
      metadata: { reason: input.reason }
    });
    return updated;
  }
}
```

- [ ] **Step 5: Implement internal routes**

Create `src/api/conversation-control-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConversationControlService } from "../application/conversations/conversation-control-service.js";
import { isAuthorized } from "./internal-auth.js";

const paramsSchema = z.object({
  clinicId: z.string().min(1),
  conversationId: z.string().min(1)
});
const bodySchema = z.object({
  reason: z.string().trim().min(1)
});

export type ConversationControlRoutesOptions = {
  adminToken: string;
  service: Pick<ConversationControlService, "pauseConversation" | "resumeConversation">;
};

export function registerConversationControlRoutes(
  app: FastifyInstance,
  options: ConversationControlRoutesOptions
) {
  app.post("/internal/onboarding/clinics/:clinicId/conversations/:conversationId/pause", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_conversation_control_request" });
    }

    try {
      const conversation = await options.service.pauseConversation({ ...params.data, reason: body.data.reason });
      return reply.send({ conversation });
    } catch (error) {
      if (isMissingConversation(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/onboarding/clinics/:clinicId/conversations/:conversationId/resume", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_conversation_control_request" });
    }

    try {
      const conversation = await options.service.resumeConversation({ ...params.data, reason: body.data.reason });
      return reply.send({ conversation });
    } catch (error) {
      if (isMissingConversation(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
}

function isMissingConversation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("not found");
}
```

Modify `src/api/app.ts`:

```ts
import {
  registerConversationControlRoutes,
  type ConversationControlRoutesOptions
} from "./conversation-control-routes.js";

type BuildAppOptions = {
  // Keep the existing BuildAppOptions properties and add this field.
  conversationControl?: ConversationControlRoutesOptions;
};

if (options.conversationControl) {
  registerConversationControlRoutes(app, options.conversationControl);
}
```

- [ ] **Step 6: Wire production runtime**

Modify `src/runtime/production-app.ts`:

```ts
import { PrismaAuditLog } from "../adapters/prisma/audit-log.js";
import { ConversationControlService } from "../application/conversations/conversation-control-service.js";

const conversationControl =
  adminConfig.enabled && sharedPrisma
    ? new ConversationControlService({
        repos: new PrismaOperationalRepository(sharedPrisma),
        audit: new PrismaAuditLog(sharedPrisma)
      })
    : undefined;

const app = buildApp({
  // Keep the current buildApp options in this object.
  conversationControl:
    adminConfig.enabled && conversationControl
      ? { adminToken: adminConfig.token, service: conversationControl }
      : undefined
});
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/conversation-control-service.test.ts tests/conversation-control-routes.test.ts tests/kapso-webhook.test.ts tests/outbound-automation-reactivation.test.ts tests/outbound-automation-reminders.test.ts tests/outbound-automation-freed-slot.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/application/conversations/conversation-control-service.ts src/api/conversation-control-routes.ts src/api/app.ts src/runtime/production-app.ts tests/conversation-control-service.test.ts tests/conversation-control-routes.test.ts
git commit -m "feat: add internal conversation pause controls"
```

## Task 7: Add Runbook, Production Docs, And Final Verification

**Files:**
- Create: `docs/runbooks/live-pilot.md`
- Modify: `README.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Create the live pilot runbook**

Create `docs/runbooks/live-pilot.md`:

````md
# Live Pilot Runbook

## Purpose

Use this runbook to deploy and activate the first real Momentum clinic pilot.

## Required Accounts

- Vercel API project rooted at the repository root.
- Vercel web project rooted at `apps/web`.
- Managed Postgres through Vercel Marketplace, preferably Neon/Postgres.
- Kapso account with a dedicated or formally migrated WhatsApp API number.
- Google Cloud OAuth client for Calendar API.
- OpenAI API key if `AI_INTERPRETER_PROVIDER=openai` is used.

## Required Production Environment

Set these in Vercel production:

```bash
MOMENTUM_RUNTIME_ENV=production
DATABASE_URL="postgresql://momentum:strong-password@db.example.com:5432/momentum?sslmode=require"
CALENDAR_PROVIDER=google
ENABLE_SIMULATION_API=false
MOMENTUM_ADMIN_TOKEN="prod-admin-token-example"
OUTBOUND_AUTOMATION_TOKEN="prod-outbound-token-example"
CRON_SECRET="prod-cron-secret-example"
MOMENTUM_CRON_CLINIC_ID="clinic_pilot"
TOKEN_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
GOOGLE_CALENDAR_CLIENT_ID="google-client-id-example"
GOOGLE_CALENDAR_CLIENT_SECRET="google-client-secret-example"
GOOGLE_CALENDAR_REDIRECT_URI="https://<production-domain>/integrations/google-calendar/callback"
GOOGLE_CALENDAR_OAUTH_STATE_SECRET="prod-google-state-secret-example"
GOOGLE_CALENDAR_SETUP_TOKEN="prod-google-setup-token-example"
WHATSAPP_PROVIDER=kapso
KAPSO_API_KEY="kapso-api-key-example"
KAPSO_WEBHOOK_SECRET="kapso-webhook-secret-example"
KAPSO_PHONE_NUMBER_ID="123456789012345"
KAPSO_BUSINESS_ACCOUNT_ID="987654321098765"
MOMENTUM_PUBLIC_WEBHOOK_URL="https://<production-domain>/webhooks/whatsapp/kapso"
AI_INTERPRETER_PROVIDER=rules
```

Set this in the Vercel web project rooted at `apps/web`:

```bash
MOMENTUM_API_BASE_URL="https://<api-production-domain>"
```

Use `AI_INTERPRETER_PROVIDER=openai` only after the deterministic pilot smoke test passes.

## Deploy

1. Provision Postgres from Vercel Marketplace.
2. Set API project production env vars.
3. Configure the API project root directory as the repository root.
4. Configure the API project build command as `npm run build:api:production`.
5. Run `npm run prisma:generate:postgres`.
6. Run `npm run prisma:migrate:deploy:postgres`.
7. Deploy the API project to Vercel.
8. Confirm `GET https://<api-production-domain>/health` returns `{ "status": "ok" }`.
9. Configure the web project root directory as `apps/web`.
10. Set `MOMENTUM_API_BASE_URL` in the web project to the API production domain.
11. Deploy the web project to Vercel.

## Google Calendar Setup

1. Enable Google Calendar API in Google Cloud.
2. Configure the OAuth redirect URL:
   `https://<production-domain>/integrations/google-calendar/callback`.
3. In Momentum private onboarding, connect Google Calendar.
4. Map every professional to a writable calendar.
5. Save the clinic profile.

## Kapso Setup

1. Use a dedicated or formally migrated WhatsApp API number.
2. Configure the webhook URL:
   `https://<production-domain>/webhooks/whatsapp/kapso`.
3. Configure the webhook signature secret to match `KAPSO_WEBHOOK_SECRET`.
4. Register the inbound WhatsApp message event used by Momentum.
5. Send one real inbound WhatsApp test after the clinic is active.

## Activation Checklist

Before activating a clinic:

- clinic profile exists;
- services, durations, prices, preparation, restrictions, and rules are configured;
- all bookable professionals have writable Google calendars;
- payment status is `paid`, `trial`, or `waived`;
- WhatsApp/Kapso env and webhook are configured;
- internal test mode passed;
- activation checklist flag is true;
- `ENABLE_SIMULATION_API=false`;
- `GET /health` is healthy.

## Smoke Test

1. Open the public landing.
2. Open private onboarding.
3. Create or load the clinic.
4. Connect Google Calendar.
5. Map professionals.
6. Pass internal test mode.
7. Activate the clinic.
8. Send a real WhatsApp message asking to book.
9. Confirm a real appointment.
10. Verify the Google Calendar event exists.
11. Reschedule through WhatsApp.
12. Verify the event moved.
13. Cancel through WhatsApp.
14. Verify the event was cancelled or deleted as designed.
15. Run the outbound cron manually:

```bash
curl -sS -X GET "https://<production-domain>/api/cron/outbound" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

16. Verify logs and audit records for inbound, booking, reschedule, cancellation, and outbound.

## Emergency Pause

Pause the clinic:

```bash
curl -sS -X POST "https://<production-domain>/internal/onboarding/clinics/<clinicId>/pause" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>"
```

Pause one conversation:

```bash
curl -sS -X POST "https://<production-domain>/internal/onboarding/clinics/<clinicId>/conversations/<conversationId>/pause" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator_handoff"}'
```

Resume one conversation:

```bash
curl -sS -X POST "https://<production-domain>/internal/onboarding/clinics/<clinicId>/conversations/<conversationId>/resume" \
  -H "Authorization: Bearer <MOMENTUM_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"operator_resolved"}'
```

## Common Failures

- `Production requires a Postgres DATABASE_URL`: production env is using SQLite or a missing database URL.
- `ENABLE_SIMULATION_API must be false in production`: disable simulation routes before production deploy.
- `clinic_inactive`: activation readiness is not complete.
- `google_calendar_reconnect_required`: reconnect Google Calendar with all required scopes.
- `unknown_provider_phone_number_id`: Kapso phone number id does not match `KAPSO_PHONE_NUMBER_ID`.
- Cron returns `401`: `CRON_SECRET` is missing or the Authorization header is wrong.
- Cron returns `outbound_cron_not_configured`: set `OUTBOUND_AUTOMATION_TOKEN` and `MOMENTUM_CRON_CLINIC_ID`.
````

- [ ] **Step 2: Update README production section**

Add this section to `README.md` after the local setup sections:

```md
## Live Pilot Production

The production pilot runbook lives at `docs/runbooks/live-pilot.md`.

Production uses:

- Vercel Functions for API/webhook routes;
- Vercel Cron for outbound automation;
- a separate Vercel web project rooted at `apps/web`;
- managed Postgres for persistence;
- Google Calendar as the calendar source of truth;
- Kapso for WhatsApp transport.

The API project must run with `MOMENTUM_RUNTIME_ENV=production`, `ENABLE_SIMULATION_API=false`, and a Postgres `DATABASE_URL`. The web project must set `MOMENTUM_API_BASE_URL` to the API production domain.
```

Update `docs/superpowers/README.md` current status so it no longer says Momentum still needs its first product spec. Replace the "First Project Step" section with:

```md
## Current Project Step

Momentum has approved product and implementation specs for the MVP foundation, WhatsApp/Kapso, Google Calendar, outbound automation, public landing/onboarding, Google calendar mapping, and live pilot production readiness.

The current implementation focus is `docs/superpowers/plans/2026-05-31-live-pilot-production-readiness.md`.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run typecheck
npm test -- --run
npx prisma validate
npm run prisma:validate:postgres
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
git diff --check
```

Expected:

- TypeScript exits 0.
- Vitest reports all test files and tests passing.
- SQLite Prisma schema is valid.
- Postgres Prisma schema is valid.
- Web typecheck exits 0.
- Next production build exits 0.
- `git diff --check` exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/live-pilot.md README.md docs/superpowers/README.md
git commit -m "docs: add live pilot runbook"
```

## Final Review Checklist

- [ ] Runtime safety rejects SQLite and simulation routes in production.
- [ ] Local SQLite development still validates and tests pass.
- [ ] Postgres schema validates and has a baseline migration.
- [ ] Vercel catch-all can serve `/health`, `/webhooks/whatsapp/kapso`, `/internal/outbound/run`, `/integrations/google-calendar/callback`, and `/leads` via rewrites.
- [ ] Cron requires `CRON_SECRET` and then calls the existing protected outbound route.
- [ ] Inactive production WhatsApp traffic is ignored, logged, and audited.
- [ ] Handoff operations can pause/resume a single conversation.
- [ ] Runbook includes deploy, Google, Kapso, activation, smoke test, and emergency pause steps.
- [ ] Full verification commands from Task 7 pass.
