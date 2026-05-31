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
