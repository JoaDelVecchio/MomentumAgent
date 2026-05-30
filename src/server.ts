import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { GoogleCalendarAdapter } from "./adapters/google/google-calendar-adapter.js";
import { GoogleCalendarApiClient } from "./adapters/google/google-calendar-client.js";
import { GoogleOAuthService } from "./adapters/google/google-oauth.js";
import { PrismaAuditLog } from "./adapters/prisma/audit-log.js";
import { KapsoWhatsAppProvider } from "./adapters/whatsapp/kapso/kapso-whatsapp-provider.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "./adapters/prisma/calendar-auth-repository.js";
import { PrismaOperationalRepository } from "./adapters/prisma/operational-repository.js";
import { ConversationWorkflow } from "./application/conversations/conversation-workflow.js";
import { WhatsAppInboundService } from "./application/messaging/whatsapp-inbound-service.js";
import { SchedulingService } from "./application/scheduling/scheduling-service.js";
import { buildApp } from "./api/app.js";
import { readGoogleCalendarConfig } from "./config/google-calendar.js";
import { readWhatsAppConfig, type WhatsAppConfig } from "./config/whatsapp.js";
import { buildDemoClinicProfile } from "./dev/demo-clinic-profile.js";
import { buildDefaultCalendar, type CalendarProvider } from "./dev/seed.js";
import type { CalendarPort } from "./ports/calendar.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const calendarProvider = readCalendarProvider(process.env.CALENDAR_PROVIDER);
const whatsappConfig = readWhatsAppConfig(process.env);
const sharedPrisma =
  calendarProvider === "google" || whatsappConfig.provider === "kapso" ? new PrismaClient() : undefined;
const googleRuntime =
  calendarProvider === "google" ? buildGoogleCalendarRuntime(requirePrisma(sharedPrisma)) : undefined;
const whatsappRuntime =
  whatsappConfig.provider === "kapso"
    ? await buildWhatsAppRuntime({
        prisma: requirePrisma(sharedPrisma),
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
  await sharedPrisma?.$disconnect();
  process.exit(0);
}

function buildGoogleCalendarRuntime(prisma: PrismaClient) {
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
    setupToken: config.setupToken,
    oauthService: new GoogleOAuthService(config, credentials),
    calendar: new GoogleCalendarAdapter(client, { timezone })
  };
}

async function buildWhatsAppRuntime(input: {
  prisma: PrismaClient;
  config: Extract<WhatsAppConfig, { provider: "kapso" }>;
  calendarProvider: CalendarProvider;
  calendar?: CalendarPort;
}) {
  const clinicId = process.env.SIMULATION_CLINIC_ID ?? "clinic_1";
  const repos = new PrismaOperationalRepository(input.prisma);
  await repos.upsertClinicProfile(buildDemoClinicProfile());
  const audit = new PrismaAuditLog(input.prisma);
  const scheduling = new SchedulingService(
    repos,
    input.calendar ?? buildDefaultCalendar(input.calendarProvider),
    audit
  );
  const workflow = new ConversationWorkflow(repos, scheduling, audit);
  const provider = new KapsoWhatsAppProvider({
    apiKey: input.config.apiKey,
    phoneNumberId: input.config.phoneNumberId
  });

  return {
    webhook: {
      secret: input.config.webhookSecret,
      phoneNumberClinicMap: { [input.config.phoneNumberId]: clinicId },
      inboundService: new WhatsAppInboundService({
        repos,
        provider,
        workflow,
        audit
      })
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
