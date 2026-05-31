import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionAppRuntime } from "../src/runtime/production-app.js";

describe("production app runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("registers onboarding test mode when admin routes are enabled", async () => {
    const runtime = await createProductionAppRuntime({
      ...process.env,
      DATABASE_URL: "file:./dev.db",
      CALENDAR_PROVIDER: "fake",
      WHATSAPP_PROVIDER: "",
      MOMENTUM_ADMIN_TOKEN: "admin_test_token",
      OUTBOUND_AUTOMATION_TOKEN: "",
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "development"
    });

    const response = await runtime.app.inject({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_unconfigured_for_route/test-message",
      headers: {
        authorization: "Bearer admin_test_token"
      },
      payload: {
        text: "Hola, quiero reservar botox."
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });

    await runtime.close();
  });

  it("disconnects Prisma if setup fails after creating the shared client", async () => {
    const disconnect = vi.spyOn(PrismaClient.prototype, "$disconnect").mockResolvedValue(undefined);

    await expect(
      createProductionAppRuntime({
        ...process.env,
        DATABASE_URL: "file:./dev.db",
        CALENDAR_PROVIDER: "google",
        WHATSAPP_PROVIDER: "",
        MOMENTUM_ADMIN_TOKEN: "",
        OUTBOUND_AUTOMATION_TOKEN: "",
        ENABLE_SIMULATION_API: "false",
        MOMENTUM_RUNTIME_ENV: "development",
        GOOGLE_CALENDAR_CLIENT_ID: ""
      })
    ).rejects.toThrow("GOOGLE_CALENDAR_CLIENT_ID is required");

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("uses Vercel Storage Postgres URLs when DATABASE_URL is blank", async () => {
    const env = {
      ...process.env,
      DATABASE_URL: "",
      STORAGE_DATABASE_URL: "postgresql://user:pass@db.example.com:5432/momentum",
      CALENDAR_PROVIDER: "fake",
      WHATSAPP_PROVIDER: "",
      MOMENTUM_ADMIN_TOKEN: "",
      OUTBOUND_AUTOMATION_TOKEN: "",
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "production"
    };

    const runtime = await createProductionAppRuntime(env);

    expect(env.DATABASE_URL).toBe("postgresql://user:pass@db.example.com:5432/momentum");
    expect(runtime.summary).toMatchObject({
      runtimeMode: "production",
      database: "postgres"
    });

    await runtime.close();
  });

  it("ignores quoted blank Vercel env placeholders before reading production config", async () => {
    const env = {
      ...process.env,
      DATABASE_URL: '""',
      STORAGE_DATABASE_URL: "postgresql://user:pass@db.example.com:5432/momentum",
      CALENDAR_PROVIDER: '""',
      WHATSAPP_PROVIDER: '""',
      MOMENTUM_ADMIN_TOKEN: '""',
      OUTBOUND_AUTOMATION_TOKEN: '""',
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "production"
    };

    const runtime = await createProductionAppRuntime(env);

    expect(env.DATABASE_URL).toBe("postgresql://user:pass@db.example.com:5432/momentum");
    expect(runtime.summary).toMatchObject({
      runtimeMode: "production",
      database: "postgres",
      calendarProvider: "fake",
      whatsappProvider: "disabled",
      adminRoutes: "disabled",
      outboundAutomation: "disabled"
    });

    await runtime.close();
  });

  it("prefers Vercel Storage Postgres URLs over a local SQLite DATABASE_URL in production", async () => {
    const env = {
      ...process.env,
      DATABASE_URL: "file:./dev.db",
      STORAGE_POSTGRES_PRISMA_URL: "postgresql://user:pass@db.example.com:5432/momentum",
      CALENDAR_PROVIDER: "fake",
      WHATSAPP_PROVIDER: "",
      MOMENTUM_ADMIN_TOKEN: "",
      OUTBOUND_AUTOMATION_TOKEN: "",
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "production"
    };

    const runtime = await createProductionAppRuntime(env);

    expect(env.DATABASE_URL).toBe("postgresql://user:pass@db.example.com:5432/momentum");
    expect(runtime.summary).toMatchObject({
      runtimeMode: "production",
      database: "postgres"
    });

    await runtime.close();
  });
});
