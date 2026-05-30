import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { AuditEvent, AuditEventInput, AuditLogPort } from "../src/ports/audit-log.js";
import type {
  SendMessageResult,
  SendTemplateMessageInput,
  SendTextMessageInput
} from "../src/ports/messaging.js";
import type { ProcessedWebhookDeliveryInput, WebhookDeliveryOutcomeInput } from "../src/ports/repositories.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("Prisma-backed runtime persistence", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeEach(() => {
    context = createPrismaTestContext("momentum-prisma-runtime-");
    prisma = context.prisma;
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("continues a pending booking after replacing repository and workflow instances", async () => {
    const first = await buildRuntime(prisma);
    await first.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Quiero reservar botox"
    });

    const second = await buildRuntime(prisma);
    const confirm = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "si"
    });

    expect(confirm).toEqual({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });

    const final = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Ana Gomez"
    });

    expect(final.kind).toBe("reply");
    expect(final.text).toContain("Turno confirmado");
    expect(await second.repos.listAppointmentsByPatient("pat_restart")).toHaveLength(1);
  });

  it("ignores duplicate webhook deliveries after replacing service instances", async () => {
    const first = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await firstService.handleInboundMessage(inbound("delivery_restart"));

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: second.audit
    });
    const duplicate = await secondService.handleInboundMessage(inbound("delivery_restart"));

    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("claims inbound deliveries in the database before workflow side effects", async () => {
    const first = await buildRuntime(prisma);
    const second = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const workflow = new BlockingWorkflow();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow,
      audit: first.audit
    });
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow,
      audit: second.audit
    });

    const firstResult = firstService.handleInboundMessage(inbound("delivery_concurrent_claim"));
    await workflow.waitUntilStarted();

    const duplicate = await secondService.handleInboundMessage(inbound("delivery_concurrent_claim"));
    workflow.release();

    await expect(firstResult).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(workflow.calls).toBe(1);
    expect(provider.sentTextMessages).toHaveLength(1);
    expect(await second.repos.hasProcessedWebhookDelivery("delivery_concurrent_claim")).toBe(true);
  });

  it("keeps duplicate deliveries from sending while the first outbound send is in flight", async () => {
    const first = await buildRuntime(prisma);
    const second = await buildRuntime(prisma);
    const provider = new BlockingWhatsAppProvider();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: second.audit
    });

    const firstResult = firstService.handleInboundMessage(inbound("delivery_concurrent_send"));
    await provider.waitUntilSendStarted();

    const duplicate = await secondService.handleInboundMessage(inbound("delivery_concurrent_send"));
    provider.release();

    await expect(firstResult).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("releases the database delivery claim when workflow fails before producing a response", async () => {
    const first = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const workflow = new FailsOnceWorkflow();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow,
      audit: first.audit
    });
    const message = inbound("delivery_workflow_failure");

    await expect(firstService.handleInboundMessage(message)).rejects.toThrow("transient workflow failure");
    expect(await first.repos.getWebhookDelivery("delivery_workflow_failure")).toBeUndefined();

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow,
      audit: second.audit
    });

    await expect(secondService.handleInboundMessage(message)).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(workflow.calls).toBe(2);
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("releases the database delivery claim when pre-response audit fails", async () => {
    const first = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: new FailingAuditLog()
    });
    const message = inbound("delivery_audit_failure");

    await expect(firstService.handleInboundMessage(message)).rejects.toThrow("transient audit failure");
    expect(await first.repos.getWebhookDelivery("delivery_audit_failure")).toBeUndefined();

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: second.audit
    });

    await expect(secondService.handleInboundMessage(message)).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("releases the database delivery claim when response persistence fails", async () => {
    const first = await buildRuntime(prisma);
    const repos = new SaveOutcomeFailsOnceRepository(prisma);
    const provider = new FakeWhatsAppProvider();
    const message = inbound("delivery_outcome_failure");
    const firstService = new WhatsAppInboundService({
      repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await expect(firstService.handleInboundMessage(message)).rejects.toThrow("transient outcome persistence failure");
    expect(await first.repos.getWebhookDelivery("delivery_outcome_failure")).toBeUndefined();
    expect(provider.sentTextMessages).toHaveLength(0);

    const secondService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await expect(secondService.handleInboundMessage(message)).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("does not mark a sent delivery ready for retry when processed persistence fails", async () => {
    const first = await buildRuntime(prisma);
    const repos = new MarkProcessedFailsOnceRepository(prisma);
    const provider = new FakeWhatsAppProvider();
    const message = inbound("delivery_mark_processed_failure");
    const firstService = new WhatsAppInboundService({
      repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await expect(firstService.handleInboundMessage(message)).rejects.toThrow("transient processed persistence failure");
    expect(provider.sentTextMessages).toHaveLength(1);

    const secondService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new UnexpectedWorkflow(),
      audit: first.audit
    });

    await expect(secondService.handleInboundMessage(message)).resolves.toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("lets only one concurrent retry claim a persisted response for sending", async () => {
    const first = await buildRuntime(prisma);
    const second = await buildRuntime(prisma);
    const provider = new BlockingWhatsAppProvider();
    const message = inbound("delivery_concurrent_retry");
    const delivery = {
      provider: "kapso" as const,
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
    };

    await first.repos.claimWebhookDelivery(delivery);
    await first.repos.saveWebhookDeliveryOutcome({
      ...delivery,
      responseText: "Respuesta persistente.",
      workflowResult: "reply"
    });
    await first.repos.markWebhookDeliveryReadyForRetry(delivery);

    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new UnexpectedWorkflow(),
      audit: first.audit
    });
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new UnexpectedWorkflow(),
      audit: second.audit
    });

    const retry = firstService.handleInboundMessage(message);
    await provider.waitUntilSendStarted();
    const duplicate = await secondService.handleInboundMessage(message);
    provider.release();

    await expect(retry).resolves.toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });

  it("resends the persisted workflow response after an outbound failure without rerunning side effects", async () => {
    const first = await buildRuntime(prisma);
    await first.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_retry_send_failure",
      patientId: "pat_retry_send_failure",
      whatsappNumber: "+5491111118888",
      text: "Quiero reservar botox"
    });
    await first.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_retry_send_failure",
      patientId: "pat_retry_send_failure",
      whatsappNumber: "+5491111118888",
      text: "si"
    });

    const provider = new FakeWhatsAppProvider();
    provider.failNextSend("kapso unavailable");
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: first.workflow,
      audit: first.audit
    });
    const finalMessage = inbound("delivery_retry_send_failure", {
      conversationId: "conv_retry_send_failure",
      patientId: "pat_retry_send_failure",
      whatsappNumber: "+5491111118888",
      text: "Ana Gomez"
    });

    await expect(firstService.handleInboundMessage(finalMessage)).rejects.toMatchObject({
      name: "WhatsAppProviderError"
    });
    expect(await first.repos.listAppointmentsByPatient("pat_retry_send_failure")).toHaveLength(1);
    expect(provider.sentTextMessages).toHaveLength(0);

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: second.workflow,
      audit: second.audit
    });
    const retry = await secondService.handleInboundMessage(finalMessage);

    expect(retry).toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(provider.sentTextMessages).toEqual([
      expect.objectContaining({ text: expect.stringContaining("Turno confirmado") })
    ]);
    expect(await second.repos.listAppointmentsByPatient("pat_retry_send_failure")).toHaveLength(1);
  });
});

async function buildRuntime(prisma: PrismaClient) {
  const repos = new PrismaOperationalRepository(prisma);
  await repos.upsertClinicProfile(profile());
  const audit = new PrismaAuditLog(prisma);
  const calendar = new FakeCalendar();
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
  ]);
  const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date("2026-05-29T12:00:00.000Z"));

  return { repos, audit, calendar, scheduling, workflow };
}

function profile() {
  return parseClinicProfile({
    clinicId: "clinic_1",
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        durationMinutes: 30,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: [],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function inbound(
  idempotencyKey: string,
  overrides: Partial<{
    providerMessageId: string;
    conversationId: string;
    patientId: string;
    whatsappNumber: string;
    text: string;
  }> = {}
) {
  return {
    clinicId: "clinic_1",
    providerPhoneNumberId: "123456789012345",
    providerMessageId: overrides.providerMessageId ?? "wamid.restart",
    conversationId: overrides.conversationId ?? "conv_duplicate_restart",
    patientId: overrides.patientId ?? "pat_duplicate_restart",
    whatsappNumber: overrides.whatsappNumber ?? "+5491111117777",
    text: overrides.text ?? "hola",
    idempotencyKey,
    receivedAt: new Date("2026-05-29T12:00:00.000Z")
  };
}

class FixedWorkflow {
  async handleInboundMessage() {
    return { kind: "reply" as const, text: "Respuesta persistente." };
  }
}

class FailsOnceWorkflow {
  calls = 0;

  async handleInboundMessage() {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error("transient workflow failure");
    }
    return { kind: "reply" as const, text: "Respuesta persistente." };
  }
}

class UnexpectedWorkflow {
  async handleInboundMessage(): Promise<never> {
    throw new Error("Workflow should not run for persisted response retries");
  }
}

class FailingAuditLog implements AuditLogPort {
  async record(_input: AuditEventInput): Promise<AuditEvent> {
    throw new Error("transient audit failure");
  }
}

class SaveOutcomeFailsOnceRepository extends PrismaOperationalRepository {
  private calls = 0;

  override async saveWebhookDeliveryOutcome(input: WebhookDeliveryOutcomeInput): Promise<void> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error("transient outcome persistence failure");
    }
    await super.saveWebhookDeliveryOutcome(input);
  }
}

class MarkProcessedFailsOnceRepository extends PrismaOperationalRepository {
  private calls = 0;

  override async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): Promise<void> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error("transient processed persistence failure");
    }
    await super.markProcessedWebhookDelivery(input);
  }
}

class BlockingWorkflow {
  calls = 0;
  private releaseWorkflow: () => void = () => {};
  private markStarted: () => void = () => {};
  private readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.releaseWorkflow = resolve;
  });

  async handleInboundMessage() {
    this.calls += 1;
    this.markStarted();
    await this.released;
    return { kind: "reply" as const, text: "Respuesta persistente." };
  }

  async waitUntilStarted() {
    await this.started;
  }

  release() {
    this.releaseWorkflow();
  }
}

class BlockingWhatsAppProvider {
  readonly sentTextMessages: Array<SendTextMessageInput & { providerMessageId: string }> = [];
  private counter = 0;
  private releaseSend: () => void = () => {};
  private markStarted: () => void = () => {};
  private readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.releaseSend = resolve;
  });

  async sendText(input: SendTextMessageInput): Promise<SendMessageResult> {
    this.markStarted();
    await this.released;
    this.counter += 1;
    const providerMessageId = `msg_${this.counter}`;
    this.sentTextMessages.push({ ...input, providerMessageId });
    return { providerMessageId };
  }

  async sendTemplate(_input: SendTemplateMessageInput): Promise<SendMessageResult> {
    throw new Error("Template messages are not used in this test");
  }

  async waitUntilSendStarted() {
    await this.started;
  }

  release() {
    this.releaseSend();
  }
}
