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
    if (await this.options.repos.hasProcessedWebhookDelivery(message.idempotencyKey)) {
      await this.auditDuplicate(message);
      return { status: "ignored_duplicate" };
    }

    await this.auditInboundAccepted(message);

    const existingConversation = await this.options.repos.getConversation(message.conversationId);
    if (existingConversation?.botPaused) {
      await this.markProcessedWebhookDelivery(message);
      await this.auditBotPaused(message);
      return { status: "bot_paused" };
    }

    const workflowResult = await this.options.workflow.handleInboundMessage({
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      patientId: message.patientId,
      whatsappNumber: message.whatsappNumber,
      text: message.text
    });

    try {
      const sendResult = await this.options.provider.sendText({
        clinicId: message.clinicId,
        to: message.whatsappNumber,
        text: workflowResult.text
      });

      await this.markProcessedWebhookDelivery(message);
      await this.auditOutboundSent(message, workflowResult, sendResult.providerMessageId);

      return {
        status: "sent",
        workflowResult: workflowResult.kind,
        providerMessageId: sendResult.providerMessageId
      };
    } catch (error) {
      await this.auditOutboundFailed(message);
      throw error;
    }
  }

  private async markProcessedWebhookDelivery(message: NormalizedWhatsAppInboundMessage) {
    await this.options.repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: message.idempotencyKey,
      clinicId: message.clinicId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
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
    workflowResult: WorkflowResult,
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
        workflowResult: workflowResult.kind
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
