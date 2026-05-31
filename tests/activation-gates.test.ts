import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createKapsoWebhookSignature } from "../src/adapters/whatsapp/kapso/signature.js";
import type { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import type { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import {
  OutboundAutomationService,
  type OutboundAutomationSummary
} from "../src/application/outbound/outbound-automation-service.js";
import type { AuditEvent, AuditEventInput, AuditLogPort } from "../src/ports/audit-log.js";
import type { CalendarPort } from "../src/ports/calendar.js";
import type { OperationalRepository } from "../src/ports/repositories.js";

const zeroSummary: OutboundAutomationSummary = { sent: 0, blocked: 0, failed: 0, skipped: 0 };

describe("production activation gates", () => {
  it("audits and logs production WhatsApp webhooks ignored for inactive clinics", async () => {
    const inboundService = new FakeInboundService();
    const audit = new FakeAuditLog();
    const logger = new FakeLogger();
    const app = buildApp({
      clinicActivation: { isClinicActive: () => false },
      logger,
      whatsappKapsoWebhook: {
        secret: "webhook_secret",
        phoneNumberClinicMap: { "123456789012345": "clinic_1" },
        inboundService: inboundService as unknown as WhatsAppInboundService,
        audit
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
    expect(audit.events).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        type: "whatsapp.inbound.ignored_inactive",
        metadata: { providerPhoneNumberId: "123456789012345" }
      })
    ]);
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "whatsapp.inbound.ignored_inactive",
        clinicId: "clinic_1",
        providerPhoneNumberId: "123456789012345"
      })
    ]);

    await app.close();
  });

  it("logs and ignores inactive WhatsApp webhook audit failures", async () => {
    const inboundService = new FakeInboundService();
    const logger = new FakeLogger();
    const app = buildApp({
      clinicActivation: { isClinicActive: () => false },
      logger,
      whatsappKapsoWebhook: {
        secret: "webhook_secret",
        phoneNumberClinicMap: { "123456789012345": "clinic_1" },
        inboundService: inboundService as unknown as WhatsAppInboundService,
        audit: new FailingAuditLog()
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
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "whatsapp.inbound.ignored_inactive",
        clinicId: "clinic_1",
        providerPhoneNumberId: "123456789012345"
      }),
      expect.objectContaining({
        level: "error",
        event: "whatsapp.inbound.audit_failed",
        clinicId: "clinic_1",
        error: expect.any(String)
      })
    ]);

    await app.close();
  });

  it("logs internal outbound runs rejected for inactive clinics without calling automation", async () => {
    const service = new FakeOutboundAutomationService();
    const logger = new FakeLogger();
    const app = buildApp({
      logger,
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
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "outbound.run.rejected_inactive",
        clinicId: "clinic_1"
      })
    ]);

    await app.close();
  });

  it("returns an empty reminder summary before loading outbound state when a direct service guard is inactive", async () => {
    const service = buildInactiveOutboundAutomationService();

    await expect(
      service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).resolves.toEqual(zeroSummary);
  });

  it("returns an empty reactivation summary before loading outbound state when a direct service guard is inactive", async () => {
    const service = buildInactiveOutboundAutomationService();

    await expect(
      service.runDueReactivations({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).resolves.toEqual(zeroSummary);
  });

  it("returns an empty freed-slot summary before loading outbound state when a direct service guard is inactive", async () => {
    const service = buildInactiveOutboundAutomationService();

    await expect(
      service.handleFreedSlot({
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        sourceAppointmentId: "appt_1",
        slot: {
          professionalId: "pro_1",
          calendarId: "cal_1",
          startsAt: new Date("2026-06-03T12:00:00.000Z"),
          endsAt: new Date("2026-06-03T12:30:00.000Z")
        },
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

function buildInactiveOutboundAutomationService() {
  return new OutboundAutomationService({
    repos: throwingRepos(),
    calendar: {} as CalendarPort,
    templateService: {
      sendApprovedTemplate: async () => ({ status: "sent", providerMessageId: "msg_1" })
    } as unknown as OutboundTemplateService,
    audit: { record: async () => undefined } as unknown as AuditLogPort,
    clinicActivation: { isClinicActive: () => false }
  });
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

class FakeAuditLog {
  readonly events: AuditEventInput[] = [];

  async record(input: AuditEventInput): Promise<AuditEvent> {
    this.events.push(input);
    return {
      id: `audit_${this.events.length}`,
      createdAt: new Date("2026-06-02T12:00:00.000Z"),
      ...input
    };
  }
}

class FailingAuditLog {
  async record(_input: AuditEventInput): Promise<AuditEvent> {
    throw new Error("audit foreign key failed");
  }
}

class FakeLogger {
  readonly entries: unknown[] = [];

  info(input: unknown) {
    this.entries.push({ level: "info", ...(input as object) });
  }

  warn(input: unknown) {
    this.entries.push({ level: "warn", ...(input as object) });
  }

  error(input: unknown) {
    this.entries.push({ level: "error", ...(input as object) });
  }
}
