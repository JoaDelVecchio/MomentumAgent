import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaOnboardingRepository } from "./adapters/prisma/onboarding-repository.js";
import { PrismaOperationalRepository } from "./adapters/prisma/operational-repository.js";
import { buildApp } from "./api/app.js";
import { GoogleCalendarOnboardingService } from "./application/onboarding/google-calendar-onboarding-service.js";
import { OnboardingService } from "./application/onboarding/onboarding-service.js";
import { readAdminConfig } from "./config/admin.js";
import { readOutboundConfig } from "./config/outbound.js";
import { readWhatsAppConfig } from "./config/whatsapp.js";
import type { CalendarProvider } from "./dev/seed.js";
import {
  buildGoogleCalendarRuntime,
  buildWhatsAppRuntime,
  needsOnboardingRuntime,
  readRuntimeClinicId
} from "./runtime/server-runtime.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const calendarProvider = readCalendarProvider(process.env.CALENDAR_PROVIDER);
const whatsappConfig = readWhatsAppConfig(process.env);
const outboundConfig = readOutboundConfig(process.env);
const adminConfig = readAdminConfig(process.env);
const onboardingRuntimeNeeded = needsOnboardingRuntime({
  adminEnabled: adminConfig.enabled,
  whatsappProvider: whatsappConfig.provider,
  outboundAutomationEnabled: outboundConfig.enabled
});
const sharedPrisma =
  calendarProvider === "google" || onboardingRuntimeNeeded
    ? new PrismaClient()
    : undefined;
const googleRuntime =
  calendarProvider === "google" ? await buildGoogleCalendarRuntime({ prisma: requirePrisma(sharedPrisma) }) : undefined;
const onboardingService = onboardingRuntimeNeeded
  ? new OnboardingService({
      onboarding: new PrismaOnboardingRepository(
        requireOnboardingPrisma(sharedPrisma, adminConfig.enabled ? "admin" : "productionActivation")
      ),
      operational: new PrismaOperationalRepository(
        requireOnboardingPrisma(sharedPrisma, adminConfig.enabled ? "admin" : "productionActivation")
      ),
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
        clinicId: readRuntimeClinicId(process.env),
        clinicActivation
      })
    : undefined;

const app = buildApp({
  enableSimulationRoutes: process.env.ENABLE_SIMULATION_API === "true",
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

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error("Prisma runtime was not initialized");
  }
  return prisma;
}

function requireOnboardingPrisma(
  prisma: PrismaClient | undefined,
  reason: "admin" | "productionActivation"
): PrismaClient {
  if (!prisma) {
    if (reason === "productionActivation") {
      throw new Error("Prisma runtime is required for production activation gates");
    }
    throw new Error("Prisma runtime is required when onboarding routes are enabled");
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
