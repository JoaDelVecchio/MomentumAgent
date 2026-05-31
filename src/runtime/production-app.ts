import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ConsoleLogger } from "../adapters/console-logger.js";
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
  prisma: PrismaClient | undefined;
  summary: RuntimeSummary;
  close: () => Promise<void>;
};

export async function createProductionAppRuntime(
  env: NodeJS.ProcessEnv = process.env
): Promise<ProductionAppRuntime> {
  const calendarProvider = readCalendarProvider(env.CALENDAR_PROVIDER);
  const whatsappConfig = readWhatsAppConfig(env);
  const outboundConfig = readOutboundConfig(env);
  const adminConfig = readAdminConfig(env);
  const runtimeMode = readRuntimeMode(env);
  const enableSimulationRoutes = env.ENABLE_SIMULATION_API === "true";
  const logger = new ConsoleLogger();

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
  const onboardingRuntimeNeeded = needsOnboardingRuntime({
    adminEnabled: adminConfig.enabled,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled
  });
  const sharedPrisma =
    calendarProvider === "google" || onboardingRuntimeNeeded
      ? new PrismaClient()
      : undefined;
  let app: FastifyInstance | undefined;

  try {
    const googleRuntime =
      calendarProvider === "google"
        ? await buildGoogleCalendarRuntime({ prisma: requirePrisma(sharedPrisma), env })
        : undefined;
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
            clinicId: readRuntimeClinicId(env),
            clinicActivation
          })
        : undefined;

    app = buildApp({
      enableSimulationRoutes,
      calendarProvider,
      simulationCalendar: googleRuntime?.calendar,
      googleCalendarOAuthService: googleRuntime?.oauthService,
      googleCalendarSetupToken: googleRuntime?.setupToken,
      whatsappKapsoWebhook: whatsappRuntime?.webhook,
      clinicActivation,
      logger,
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
    const runtimeApp = app;

    return {
      app: runtimeApp,
      prisma: sharedPrisma,
      summary,
      close: async () => {
        await runtimeApp.close();
        await sharedPrisma?.$disconnect();
      }
    };
  } catch (error) {
    await app?.close();
    await sharedPrisma?.$disconnect();
    throw error;
  }
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
