import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createKapsoWebhookSignature } from "../src/adapters/whatsapp/kapso/signature.js";
import type { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import type { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import {
  OutboundAutomationService,
  type OutboundAutomationSummary
} from "../src/application/outbound/outbound-automation-service.js";
import type { AuditLogPort } from "../src/ports/audit-log.js";
import type { CalendarPort } from "../src/ports/calendar.js";
import type { OperationalRepository } from "../src/ports/repositories.js";

const zeroSummary: OutboundAutomationSummary = { sent: 0, blocked: 0, failed: 0, skipped: 0 };

describe("production activation gates", () => {
  it("ignores production WhatsApp webhooks for inactive clinics without calling inbound handling", async () => {
    const inboundService = new FakeInboundService();
    const app = buildApp({
      clinicActivation: { isClinicActive: () => false },
      whatsappKapsoWebhook: {
        secret: "webhook_secret",
        phoneNumberClinicMap: { "123456789012345": "clinic_1" },
        inboundService: inboundService as unknown as WhatsAppInboundService
      }
    });
    const rawBody = JSON.stringify(kapsoReceivedMessagePayload());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored", reason: "clinic_inactive" });
    expect(inboundService.calls).toBe(0);

    await app.close();
  });

  it("rejects internal outbound runs for inactive clinics without calling automation", async () => {
    const service = new FakeOutboundAutomationService();
    const app = buildApp({
      clinicActivation: { isClinicActive: () => false },
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "clinic_inactive" });
    expect(service.calls).toEqual([]);

    await app.close();
  });

  it("returns an empty reminder summary before loading outbound state when a direct service guard is inactive", async () => {
    const service = new OutboundAutomationService({
      repos: throwingRepos(),
      calendar: {} as CalendarPort,
      templateService: {
        sendApprovedTemplate: async () => ({ status: "sent", providerMessageId: "msg_1" })
      } as unknown as OutboundTemplateService,
      audit: { record: async () => undefined } as unknown as AuditLogPort,
      clinicActivation: { isClinicActive: () => false }
    });

    await expect(
      service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).resolves.toEqual(zeroSummary);
  });
});

function kapsoReceivedMessagePayload() {
  return {
    event: "whatsapp.message.received",
    message: {
      id: "wamid.123",
      timestamp: "1730092800",
      type: "text",
      from: "16315551181",
      from_user_id: "US.13491208655302741918",
      text: { body: "Quiero reservar botox" },
      kapso: {
        direction: "inbound",
        status: "received",
        processing_status: "pending",
        origin: "cloud_api",
        has_media: false,
        content: "Quiero reservar botox"
      }
    },
    conversation: {
      id: "conv_123",
      phone_number: "16315551181",
      business_scoped_user_id: "US.13491208655302741918",
      status: "active",
      phone_number_id: "123456789012345"
    },
    is_new_conversation: true,
    phone_number_id: "123456789012345"
  };
}

function signedWebhookHeaders(rawBody: string) {
  return {
    "Content-Type": "application/json",
    "X-Webhook-Signature": createKapsoWebhookSignature(rawBody, "webhook_secret"),
    "X-Idempotency-Key": "delivery_1"
  };
}

function throwingRepos() {
  return {
    getClinicProfile: () => {
      throw new Error("profile should not be loaded for inactive clinics");
    }
  } as unknown as OperationalRepository;
}

class FakeInboundService {
  calls = 0;

  async handleInboundMessage() {
    this.calls += 1;
    return { status: "sent", workflowResult: "reply", providerMessageId: "msg_1" };
  }
}

class FakeOutboundAutomationService {
  readonly calls: string[] = [];

  async runDueReminders(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reminders:${input.clinicId}:${input.now.toISOString()}`);
    return { ...zeroSummary, sent: 1 };
  }

  async runDueReactivations(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reactivations:${input.clinicId}:${input.now.toISOString()}`);
    return { ...zeroSummary, sent: 2 };
  }
}
