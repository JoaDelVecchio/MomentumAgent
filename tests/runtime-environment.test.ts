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
