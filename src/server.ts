import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { GoogleCalendarAdapter } from "./adapters/google/google-calendar-adapter.js";
import { GoogleCalendarApiClient } from "./adapters/google/google-calendar-client.js";
import { GoogleOAuthService } from "./adapters/google/google-oauth.js";
import { KapsoWhatsAppProvider } from "./adapters/whatsapp/kapso/kapso-whatsapp-provider.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "./adapters/prisma/calendar-auth-repository.js";
import { WhatsAppInboundService } from "./application/messaging/whatsapp-inbound-service.js";
import { buildApp } from "./api/app.js";
import { readGoogleCalendarConfig } from "./config/google-calendar.js";
import { readWhatsAppConfig, type WhatsAppConfig } from "./config/whatsapp.js";
import { buildDevContainer, type CalendarProvider } from "./dev/seed.js";
import type { CalendarPort } from "./ports/calendar.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const calendarProvider = readCalendarProvider(process.env.CALENDAR_PROVIDER);
const googleRuntime = calendarProvider === "google" ? buildGoogleCalendarRuntime() : undefined;
const whatsappConfig = readWhatsAppConfig(process.env);
const whatsappRuntime =
  whatsappConfig.provider === "kapso"
    ? buildWhatsAppRuntime({
        config: whatsappConfig,
        calendarProvider,
        calendar: googleRuntime?.calendar
      })
    : undefined;

const app = buildApp({
  enableSimulationRoutes: process.env.ENABLE_SIMULATION_API === "true",
  calendarProvider,
  simulationCalendar: googleRuntime?.calendar,
  googleCalendarOAuthService: googleRuntime?.oauthService,
  googleCalendarSetupToken: googleRuntime?.setupToken,
  whatsappKapsoWebhook: whatsappRuntime?.webhook
});

await app.listen({ port, host });
console.log(`Momentum API listening on http://${host}:${port}`);

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  await app.close();
  await googleRuntime?.prisma.$disconnect();
  process.exit(0);
}

function buildGoogleCalendarRuntime() {
  const prisma = new PrismaClient();
  const config = readGoogleCalendarConfig(process.env);
  const credentials = new PrismaCalendarCredentialRepository(
    prisma,
    Aes256GcmTokenCipher.fromEnvironment(process.env)
  );
  const clinicId = process.env.SIMULATION_CLINIC_ID ?? "clinic_1";
  const timezone = process.env.SIMULATION_CLINIC_TIMEZONE ?? "America/Argentina/Buenos_Aires";
  const client = new GoogleCalendarApiClient({
    clinicId,
    credentialRepository: credentials,
    config
  });

  return {
    prisma,
    setupToken: config.setupToken,
    oauthService: new GoogleOAuthService(config, credentials),
    calendar: new GoogleCalendarAdapter(client, { timezone })
  };
}

function buildWhatsAppRuntime(input: {
  config: Extract<WhatsAppConfig, { provider: "kapso" }>;
  calendarProvider: CalendarProvider;
  calendar?: CalendarPort;
}) {
  const clinicId = process.env.SIMULATION_CLINIC_ID ?? "clinic_1";
  const container = buildDevContainer({
    calendarProvider: input.calendarProvider,
    calendar: input.calendar
  });
  const provider = new KapsoWhatsAppProvider({
    apiKey: input.config.apiKey,
    phoneNumberId: input.config.phoneNumberId
  });

  return {
    webhook: {
      secret: input.config.webhookSecret,
      phoneNumberClinicMap: { [input.config.phoneNumberId]: clinicId },
      inboundService: new WhatsAppInboundService({
        repos: container.repos,
        provider,
        workflow: container.workflow,
        audit: container.audit
      })
    }
  };
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
