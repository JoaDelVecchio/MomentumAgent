import type { AuditLogPort } from "../../ports/audit-log.js";
import type { NormalizedWhatsAppInboundMessage, WhatsAppProvider } from "../../ports/messaging.js";
import type { OperationalRepository } from "../../ports/repositories.js";
import type { WorkflowResult } from "../conversations/conversation-workflow.js";

type ConversationWorkflowPort = {
  handleInboundMessage(input: {
    clinicId: string;
    conversationId: string;
    patientId: string;
    whatsappNumber: string;
    text: string;
  }): Promise<WorkflowResult>;
};

export type WhatsAppInboundServiceOptions = {
  repos: OperationalRepository;
  provider: WhatsAppProvider;
  workflow: ConversationWorkflowPort;
  audit: AuditLogPort;
};

export type WhatsAppInboundResult =
  | { status: "sent"; workflowResult: WorkflowResult["kind"]; providerMessageId: string }
  | { status: "ignored_duplicate" }
  | { status: "bot_paused" };

export class WhatsAppInboundService {
  constructor(private readonly options: WhatsAppInboundServiceOptions) {}

  async handleInboundMessage(message: NormalizedWhatsAppInboundMessage): Promise<WhatsAppInboundResult> {
    return this.options.repos.withWebhookDeliveryLock(message.idempotencyKey, () =>
      this.handleInboundMessageLocked(message)
    );
  }

  private async handleInboundMessageLocked(
    message: NormalizedWhatsAppInboundMessage
  ): Promise<WhatsAppInboundResult> {
    const deliveryClaim = await this.options.repos.claimWebhookDelivery({
      provider: "kapso",
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
    });
    if (deliveryClaim.kind === "retry") {
      return await this.sendPersistedWorkflowResult(message, deliveryClaim.delivery);
    }
    if (deliveryClaim.kind === "existing") {
      await this.auditDuplicate(message);
      return { status: "ignored_duplicate" };
    }

    let workflowResult: WorkflowResult;
    try {
      await this.auditInboundAccepted(message);

      const existingConversation = await this.options.repos.getConversation({
        clinicId: message.clinicId,
        conversationId: message.conversationId
      });
      if (existingConversation?.botPaused) {
        await this.markProcessedWebhookDelivery(message);
        await this.auditBotPaused(message);
        return { status: "bot_paused" };
      }

      workflowResult = await this.options.workflow.handleInboundMessage({
        clinicId: message.clinicId,
        conversationId: message.conversationId,
        patientId: message.patientId,
        whatsappNumber: message.whatsappNumber,
        text: message.text
      });

      await this.options.repos.saveWebhookDeliveryOutcome({
        provider: "kapso",
        idempotencyKey: message.idempotencyKey,
        clinicId: message.clinicId,
        conversationId: message.conversationId,
        providerMessageId: message.providerMessageId,
        responseText: workflowResult.text,
        workflowResult: workflowResult.kind
      });
    } catch (error) {
      await this.releaseWebhookDeliveryClaim(message);
      throw error;
    }

    const sendResult = await this.sendTextOrMarkReadyForRetry(message, workflowResult.text);

    await this.markProcessedWebhookDelivery(message, sendResult.providerMessageId);
    await this.auditOutboundSent(message, workflowResult.kind, sendResult.providerMessageId);

    return {
      status: "sent",
      workflowResult: workflowResult.kind,
      providerMessageId: sendResult.providerMessageId
    };
  }

  private async sendPersistedWorkflowResult(
    message: NormalizedWhatsAppInboundMessage,
    delivery: { responseText?: string; workflowResult?: WorkflowResult["kind"] }
  ): Promise<WhatsAppInboundResult> {
    if (!delivery.responseText || !delivery.workflowResult) {
      throw new Error(`Webhook delivery ${message.idempotencyKey} is missing persisted response data`);
    }

    const sendResult = await this.sendTextOrMarkReadyForRetry(message, delivery.responseText);

    await this.markProcessedWebhookDelivery(message, sendResult.providerMessageId);
    await this.auditOutboundSent(message, delivery.workflowResult, sendResult.providerMessageId);

    return {
      status: "sent",
      workflowResult: delivery.workflowResult,
      providerMessageId: sendResult.providerMessageId
    };
  }

  private async sendTextOrMarkReadyForRetry(message: NormalizedWhatsAppInboundMessage, text: string) {
    try {
      return await this.options.provider.sendText({
        clinicId: message.clinicId,
        to: message.whatsappNumber,
        text
      });
    } catch (error) {
      await this.markWebhookDeliveryReadyForRetry(message);
      await this.auditOutboundFailed(message);
      throw error;
    }
  }

  private async markWebhookDeliveryReadyForRetry(message: NormalizedWhatsAppInboundMessage) {
    await this.options.repos.markWebhookDeliveryReadyForRetry({
      provider: "kapso",
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
    });
  }

  private async releaseWebhookDeliveryClaim(message: NormalizedWhatsAppInboundMessage) {
    await this.options.repos.releaseWebhookDeliveryClaim({
      provider: "kapso",
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
    });
  }

  private async markProcessedWebhookDelivery(message: NormalizedWhatsAppInboundMessage, outboundProviderMessageId?: string) {
    await this.options.repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId,
      outboundProviderMessageId
    });
  }

  private async auditInboundAccepted(message: NormalizedWhatsAppInboundMessage) {
    await this.options.audit.record({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: {
        idempotencyKey: message.idempotencyKey,
        providerMessageId: message.providerMessageId,
        providerPhoneNumberId: message.providerPhoneNumberId
      }
    });
  }

  private async auditDuplicate(message: NormalizedWhatsAppInboundMessage) {
    await this.options.audit.record({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      type: "whatsapp.inbound.duplicate",
      message: "Ignored duplicate WhatsApp inbound delivery",
      metadata: {
        idempotencyKey: message.idempotencyKey,
        providerMessageId: message.providerMessageId,
        providerPhoneNumberId: message.providerPhoneNumberId
      }
    });
  }

  private async auditBotPaused(message: NormalizedWhatsAppInboundMessage) {
    await this.options.audit.record({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      type: "whatsapp.inbound.bot_paused",
      message: "Ignored WhatsApp inbound delivery because bot is paused",
      metadata: {
        idempotencyKey: message.idempotencyKey,
        providerMessageId: message.providerMessageId,
        providerPhoneNumberId: message.providerPhoneNumberId
      }
    });
  }

  private async auditOutboundSent(
    message: NormalizedWhatsAppInboundMessage,
    workflowResult: WorkflowResult["kind"],
    providerMessageId: string
  ) {
    await this.options.audit.record({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      type: "whatsapp.outbound.sent",
      message: "Sent WhatsApp outbound reply",
      metadata: {
        inboundProviderMessageId: message.providerMessageId,
        providerMessageId,
        providerPhoneNumberId: message.providerPhoneNumberId,
        workflowResult
      }
    });
  }

  private async auditOutboundFailed(message: NormalizedWhatsAppInboundMessage) {
    await this.options.audit.record({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      type: "whatsapp.outbound.failed",
      message: "Failed to send WhatsApp outbound reply",
      metadata: {
        providerMessageId: message.providerMessageId,
        providerPhoneNumberId: message.providerPhoneNumberId
      }
    });
  }
}
