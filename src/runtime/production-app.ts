import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ConsoleLogger } from "../adapters/console-logger.js";
import { PrismaAuditLog } from "../adapters/prisma/audit-log.js";
import { PrismaOnboardingRepository } from "../adapters/prisma/onboarding-repository.js";
import { PrismaOperationalRepository } from "../adapters/prisma/operational-repository.js";
import { buildApp } from "../api/app.js";
import { ConversationControlService } from "../application/conversations/conversation-control-service.js";
import { GoogleCalendarOnboardingService } from "../application/onboarding/google-calendar-onboarding-service.js";
import { OnboardingService } from "../application/onboarding/onboarding-service.js";
import { OnboardingTestModeService } from "../application/onboarding/test-mode-service.js";
import { readAdminConfig } from "../config/admin.js";
import { readAIConfig } from "../config/ai.js";
import { optionalEnv } from "../config/env.js";
import { readOutboundConfig } from "../config/outbound.js";
import {
  assertRuntimeSafety,
  buildRuntimeSummary,
  readRuntimeMode,
  type RuntimeSummary
} from "../config/runtime-environment.js";
import { readWhatsAppConfig } from "../config/whatsapp.js";
import { buildDefaultCalendar, type CalendarProvider } from "../dev/seed.js";
import {
  buildConversationReceptionistAgent,
  buildConversationResponseComposer,
  buildConversationInterpreter,
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
  const databaseUrl = readDatabaseUrl(env);
  const logger = new ConsoleLogger();

  assertRuntimeSafety({
    runtimeMode,
    databaseUrl,
    enableSimulationApi: enableSimulationRoutes,
    calendarProvider,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled,
    adminEnabled: adminConfig.enabled,
    publicWebhookUrl: whatsappConfig.provider === "kapso" ? whatsappConfig.publicWebhookUrl : undefined
  });

  const summary = buildRuntimeSummary({
    runtimeMode,
    databaseUrl,
    enableSimulationApi: enableSimulationRoutes,
    calendarProvider,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled,
    adminEnabled: adminConfig.enabled,
    publicWebhookUrl: whatsappConfig.provider === "kapso" ? whatsappConfig.publicWebhookUrl : undefined
  });
  const aiConfig = readAIConfig(env);
  const conversationInterpreter = buildConversationInterpreter(aiConfig);
  const conversationReceptionistAgent = buildConversationReceptionistAgent(aiConfig);
  const conversationResponseComposer = buildConversationResponseComposer(aiConfig);
  const onboardingRuntimeNeeded = needsOnboardingRuntime({
    adminEnabled: adminConfig.enabled,
    whatsappProvider: whatsappConfig.provider,
    outboundAutomationEnabled: outboundConfig.enabled
  });
  const sharedPrisma =
    calendarProvider === "google" || onboardingRuntimeNeeded
      ? createPrismaClient(databaseUrl)
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
    const onboardingTestModeService =
      adminConfig.enabled && onboardingService
        ? new OnboardingTestModeService({
            onboarding: new PrismaOnboardingRepository(requirePrisma(sharedPrisma)),
            operational: new PrismaOperationalRepository(requirePrisma(sharedPrisma)),
            audit: new PrismaAuditLog(requirePrisma(sharedPrisma)),
            calendar: googleRuntime?.calendar ?? buildDefaultCalendar(calendarProvider),
            interpreter: conversationInterpreter,
            receptionistAgent: conversationReceptionistAgent,
            responseComposer: conversationResponseComposer
          })
        : undefined;
    const conversationControl =
      adminConfig.enabled && sharedPrisma
        ? new ConversationControlService({
            repos: new PrismaOperationalRepository(sharedPrisma),
            audit: new PrismaAuditLog(sharedPrisma)
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
            interpreter: conversationInterpreter,
            receptionistAgent: conversationReceptionistAgent,
            responseComposer: conversationResponseComposer,
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
          ? { adminToken: adminConfig.token, service: onboardingService, testModeService: onboardingTestModeService }
          : undefined,
      googleCalendarOnboarding:
        adminConfig.enabled && googleCalendarOnboardingService
          ? { adminToken: adminConfig.token, service: googleCalendarOnboardingService }
          : undefined,
      conversationControl:
        adminConfig.enabled && conversationControl
          ? { adminToken: adminConfig.token, service: conversationControl }
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

function createPrismaClient(databaseUrl: string | undefined): PrismaClient {
  if (!databaseUrl) {
    return new PrismaClient();
  }
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl
      }
    }
  });
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
  const normalizedProvider = optionalEnv(provider);
  if (!normalizedProvider || normalizedProvider === "fake") {
    return "fake";
  }
  if (normalizedProvider === "google") {
    return "google";
  }
  throw new Error(`Unsupported CALENDAR_PROVIDER: ${normalizedProvider}`);
}

function readDatabaseUrl(env: NodeJS.ProcessEnv) {
  const candidates = [
    firstPresent(env.DATABASE_URL),
    firstPresent(env.STORAGE_DATABASE_URL),
    firstPresent(env.STORAGE_POSTGRES_PRISMA_URL),
    firstPresent(env.STORAGE_POSTGRES_URL)
  ].filter((value): value is string => Boolean(value));

  return candidates.find(isPostgresUrl) ?? candidates[0];
}

function firstPresent(value: string | undefined) {
  return optionalEnv(value);
}

function isPostgresUrl(value: string) {
  return value.startsWith("postgresql://") || value.startsWith("postgres://");
}
