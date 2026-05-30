import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleOAuthClient } from "../src/adapters/google/google-oauth.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "../src/adapters/prisma/calendar-auth-repository.js";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import type { ConversationInterpreter, ConversationInterpreterInput } from "../src/application/conversations/interpreter.js";
import {
  buildGoogleCalendarRuntime,
  buildWhatsAppRuntime,
  needsOnboardingRuntime
} from "../src/runtime/server-runtime.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("server runtime persistence wiring", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-server-runtime-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds the configured clinic id for Kapso persistence", async () => {
    const runtime = await buildWhatsAppRuntime({
      prisma,
      clinicId: "clinic_runtime_kapso",
      config: {
        provider: "kapso",
        apiKey: "kapso_api_key",
        webhookSecret: "kapso_webhook_secret",
        phoneNumberId: "123456789012345"
      },
      calendarProvider: "fake",
      aiConfig: { provider: "rules" }
    });

    const audit = new PrismaAuditLog(prisma);
    const event = await audit.record({
      clinicId: "clinic_runtime_kapso",
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: { idempotencyKey: "delivery_runtime" }
    });

    expect(runtime.webhook.phoneNumberClinicMap).toEqual({
      "123456789012345": "clinic_runtime_kapso"
    });
    expect(await prisma.clinic.findUnique({ where: { id: "clinic_runtime_kapso" } })).toMatchObject({
      id: "clinic_runtime_kapso"
    });
    expect(event.clinicId).toBe("clinic_runtime_kapso");
  });

  it("uses an injected conversation interpreter for Kapso inbound messages", async () => {
    const interpreter = new FakeConversationInterpreter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ messages: [{ id: "wamid.runtime_interpreter" }] }))
    );
    const runtime = await buildWhatsAppRuntime({
      prisma,
      clinicId: "clinic_runtime_interpreter",
      config: {
        provider: "kapso",
        apiKey: "kapso_api_key",
        webhookSecret: "kapso_webhook_secret",
        phoneNumberId: "123456789012346"
      },
      calendarProvider: "fake",
      interpreter
    });

    await runtime.webhook.inboundService.handleInboundMessage({
      idempotencyKey: "delivery_runtime_interpreter",
      clinicId: "clinic_runtime_interpreter",
      conversationId: "conversation_runtime_interpreter",
      patientId: "patient_runtime_interpreter",
      whatsappNumber: "+5491111111111",
      providerMessageId: "wamid.inbound_runtime_interpreter",
      providerPhoneNumberId: "123456789012346",
      text: "hola",
      receivedAt: new Date("2026-05-30T12:00:00.000Z")
    });

    expect(interpreter.calls).toHaveLength(1);
    expect(interpreter.calls[0]).toMatchObject({
      clinicId: "clinic_runtime_interpreter",
      conversationId: "conversation_runtime_interpreter",
      patientId: "patient_runtime_interpreter",
      messageText: "hola"
    });
  });

  it("exposes outbound automation from the Kapso runtime", async () => {
    const runtime = await buildWhatsAppRuntime({
      prisma,
      clinicId: "clinic_runtime_outbound",
      config: {
        provider: "kapso",
        apiKey: "kapso_api_key",
        webhookSecret: "kapso_webhook_secret",
        phoneNumberId: "123456789012347"
      },
      calendarProvider: "fake",
      aiConfig: { provider: "rules" }
    });

    expect(runtime.outboundAutomation.runDueReminders).toEqual(expect.any(Function));
    expect(runtime.outboundAutomation.runDueReactivations).toEqual(expect.any(Function));
    expect(runtime.outboundAutomation.handleFreedSlot).toEqual(expect.any(Function));
  });

  it("seeds the configured clinic id for Google credential persistence", async () => {
    const clinicId = "clinic_runtime_google";
    await buildGoogleCalendarRuntime({
      prisma,
      env: {
        ...process.env,
        SIMULATION_CLINIC_ID: clinicId,
        GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
        GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/integrations/google-calendar/callback",
        GOOGLE_CALENDAR_OAUTH_STATE_SECRET: "google-state-secret",
        GOOGLE_CALENDAR_SETUP_TOKEN: "google-setup-token",
        TOKEN_ENCRYPTION_KEY: "01".repeat(32)
      },
      googleOAuthClientFactory: (config) => new FakeGoogleOAuthClient(config)
    });
    const credentials = new PrismaCalendarCredentialRepository(
      prisma,
      new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4))
    );
    const callbackClinicId = "clinic_runtime_google_callback";
    const runtime = await buildGoogleCalendarRuntime({
      prisma,
      env: {
        ...process.env,
        SIMULATION_CLINIC_ID: clinicId,
        GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
        GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/integrations/google-calendar/callback",
        GOOGLE_CALENDAR_OAUTH_STATE_SECRET: "google-state-secret",
        GOOGLE_CALENDAR_SETUP_TOKEN: "google-setup-token",
        TOKEN_ENCRYPTION_KEY: "01".repeat(32)
      },
      googleOAuthClientFactory: (config) => new FakeGoogleOAuthClient(config)
    });
    const state = new URL(runtime.oauthService.createAuthorizationUrl(callbackClinicId)).searchParams.get("state");

    await credentials.save({
      clinicId,
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      refreshToken: "google_refresh_token"
    });

    await expect(prisma.clinic.findUnique({ where: { id: clinicId } })).resolves.toMatchObject({ id: clinicId });
    await expect(credentials.get({ clinicId, provider: "google" })).resolves.toMatchObject({
      clinicId,
      provider: "google",
      refreshToken: "google_refresh_token"
    });

    await runtime.oauthService.handleCallback("oauth_code", state ?? "");
    await expect(credentials.get({ clinicId: callbackClinicId, provider: "google" })).resolves.toMatchObject({
      clinicId: callbackClinicId,
      provider: "google",
      refreshToken: "google_refresh_token_from_callback"
    });
  });
});

describe("server startup runtime decisions", () => {
  it("requires onboarding runtime when admin routes are enabled", () => {
    expect(
      needsOnboardingRuntime({
        adminEnabled: true,
        whatsappProvider: "disabled",
        outboundAutomationEnabled: false
      })
    ).toBe(true);
  });

  it("requires onboarding runtime for Kapso production automation even when admin routes are disabled", () => {
    expect(
      needsOnboardingRuntime({
        adminEnabled: false,
        whatsappProvider: "kapso",
        outboundAutomationEnabled: true
      })
    ).toBe(true);
  });

  it("does not require onboarding runtime when only outbound token is configured without WhatsApp runtime", () => {
    expect(
      needsOnboardingRuntime({
        adminEnabled: false,
        whatsappProvider: "disabled",
        outboundAutomationEnabled: true
      })
    ).toBe(false);
  });

  it("does not require onboarding runtime when only simulation or Google runtime is enabled", () => {
    expect(
      needsOnboardingRuntime({
        adminEnabled: false,
        whatsappProvider: "disabled",
        outboundAutomationEnabled: false
      })
    ).toBe(false);
  });
});

class FakeConversationInterpreter implements ConversationInterpreter {
  calls: ConversationInterpreterInput[] = [];

  async interpret(input: ConversationInterpreterInput) {
    this.calls.push(input);
    return {
      provider: "rules" as const,
      intent: "unknown" as const,
      confidence: 0.5,
      requestedTopics: [],
      requiresHuman: false,
      reason: "Fake interpreter for runtime wiring test."
    };
  }
}

class FakeGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private readonly config: { clientId: string; redirectUri: string }) {}

  generateAuthUrl(input: {
    access_type: "offline";
    prompt: "consent";
    scope: string[];
    state: string;
    include_granted_scopes: boolean;
  }) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      access_type: input.access_type,
      prompt: input.prompt,
      scope: input.scope.join(" "),
      state: input.state,
      include_granted_scopes: String(input.include_granted_scopes)
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async getToken(_input: { code: string }) {
    return {
      tokens: {
        access_token: "google_access_token_from_callback",
        refresh_token: "google_refresh_token_from_callback",
        expiry_date: Date.parse("2026-06-01T12:00:00.000Z"),
        scope: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.events.freebusy"
        ].join(" ")
      }
    };
  }
}
