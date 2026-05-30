import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { OpenAIConversationInterpreter } from "../adapters/openai/openai-conversation-interpreter.js";
import { GoogleCalendarAdapter } from "../adapters/google/google-calendar-adapter.js";
import { GoogleCalendarApiClient } from "../adapters/google/google-calendar-client.js";
import { GoogleOAuthService, type GoogleOAuthClient } from "../adapters/google/google-oauth.js";
import { PrismaAuditLog } from "../adapters/prisma/audit-log.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "../adapters/prisma/calendar-auth-repository.js";
import { PrismaOperationalRepository } from "../adapters/prisma/operational-repository.js";
import { KapsoWhatsAppProvider } from "../adapters/whatsapp/kapso/kapso-whatsapp-provider.js";
import { ConversationWorkflow } from "../application/conversations/conversation-workflow.js";
import type { ConversationInterpreter } from "../application/conversations/interpreter.js";
import { RulesConversationInterpreter } from "../application/conversations/rules-interpreter.js";
import { OutboundTemplateService } from "../application/messaging/outbound-template-service.js";
import { WhatsAppInboundService } from "../application/messaging/whatsapp-inbound-service.js";
import { OutboundAutomationService } from "../application/outbound/outbound-automation-service.js";
import { SchedulingService } from "../application/scheduling/scheduling-service.js";
import { readAIConfig, type AIConfig } from "../config/ai.js";
import { readGoogleCalendarConfig, type GoogleCalendarConfig } from "../config/google-calendar.js";
import type { WhatsAppConfig } from "../config/whatsapp.js";
import { buildDemoClinicProfile } from "../dev/demo-clinic-profile.js";
import { buildDefaultCalendar, type CalendarProvider } from "../dev/seed.js";
import type { ClinicActivationGuard } from "../ports/activation.js";
import type { CalendarPort } from "../ports/calendar.js";
import type {
  CalendarCredentialInput,
  CalendarCredentialLookup,
  CalendarCredentialRepository
} from "../ports/calendar-auth.js";

type GoogleOAuthClientFactory = (config: GoogleCalendarConfig) => GoogleOAuthClient;

export async function buildGoogleCalendarRuntime(input: {
  prisma: PrismaClient;
  env?: NodeJS.ProcessEnv;
  googleOAuthClientFactory?: GoogleOAuthClientFactory;
}) {
  const env = input.env ?? process.env;
  const config = readGoogleCalendarConfig(env);
  const clinicId = readRuntimeClinicId(env);
  await seedRuntimeClinicProfile(input.prisma, clinicId);

  const persistedCredentials = new PrismaCalendarCredentialRepository(
    input.prisma,
    Aes256GcmTokenCipher.fromEnvironment(env)
  );
  const credentials = new SeedingCalendarCredentialRepository(input.prisma, persistedCredentials);
  const timezone = env.SIMULATION_CLINIC_TIMEZONE ?? "America/Argentina/Buenos_Aires";
  const client = new GoogleCalendarApiClient({
    clinicId,
    credentialRepository: credentials,
    config
  });

  return {
    setupToken: config.setupToken,
    oauthService: new GoogleOAuthService(config, credentials, input.googleOAuthClientFactory),
    calendar: new GoogleCalendarAdapter(client, { timezone })
  };
}

export async function buildWhatsAppRuntime(input: {
  prisma: PrismaClient;
  config: Extract<WhatsAppConfig, { provider: "kapso" }>;
  calendarProvider: CalendarProvider;
  calendar?: CalendarPort;
  clinicId?: string;
  aiConfig?: AIConfig;
  interpreter?: ConversationInterpreter;
  clinicActivation?: ClinicActivationGuard;
}) {
  const clinicId = input.clinicId ?? readRuntimeClinicId();
  const repos = new PrismaOperationalRepository(input.prisma);
  await repos.upsertClinicProfile(buildDemoClinicProfile(clinicId));
  const audit = new PrismaAuditLog(input.prisma);
  const calendar = input.calendar ?? buildDefaultCalendar(input.calendarProvider);
  const provider = new KapsoWhatsAppProvider({
    apiKey: input.config.apiKey,
    phoneNumberId: input.config.phoneNumberId
  });
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const outboundAutomation = new OutboundAutomationService({
    repos,
    calendar,
    templateService,
    audit,
    clinicActivation: input.clinicActivation
  });
  const scheduling = new SchedulingService(
    repos,
    calendar,
    audit,
    () => new Date(),
    {
      handleFreedSlot: async (freedSlot) => {
        await outboundAutomation.handleFreedSlot({ ...freedSlot, now: new Date() });
      }
    }
  );
  const interpreter = input.interpreter ?? buildConversationInterpreter(input.aiConfig ?? readAIConfig());
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date(), interpreter);

  return {
    outboundAutomation,
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

function buildConversationInterpreter(config: AIConfig): ConversationInterpreter {
  if (config.provider === "rules") {
    return new RulesConversationInterpreter();
  }

  return new OpenAIConversationInterpreter({
    client: new OpenAI({ apiKey: config.apiKey }),
    model: config.model,
    timeoutMs: config.timeoutMs
  });
}

export async function seedRuntimeClinicProfile(prisma: PrismaClient, clinicId: string) {
  const repos = new PrismaOperationalRepository(prisma);
  await repos.upsertClinicProfile(buildDemoClinicProfile(clinicId));
}

export function readRuntimeClinicId(env: NodeJS.ProcessEnv = process.env) {
  return env.SIMULATION_CLINIC_ID ?? "clinic_1";
}

export function needsOnboardingRuntime(input: {
  adminEnabled: boolean;
  whatsappProvider: WhatsAppConfig["provider"];
  outboundAutomationEnabled: boolean;
}) {
  return input.adminEnabled || input.whatsappProvider === "kapso";
}

class SeedingCalendarCredentialRepository implements CalendarCredentialRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly delegate: CalendarCredentialRepository
  ) {}

  async save(input: CalendarCredentialInput) {
    await seedRuntimeClinicProfile(this.prisma, input.clinicId);
    return this.delegate.save(input);
  }

  async get(lookup: CalendarCredentialLookup) {
    return this.delegate.get(lookup);
  }
}
