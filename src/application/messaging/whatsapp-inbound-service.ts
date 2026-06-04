import type { AuditLogPort } from "../../ports/audit-log.js";
import type {
  NormalizedWhatsAppInboundMessage,
  SendInteractiveMessageInput,
  WhatsAppProvider
} from "../../ports/messaging.js";
import type { Conversation, OperationalRepository, PendingBooking } from "../../ports/repositories.js";
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
  interactive?: WhatsAppInboundInteractiveOptions;
};

export type WhatsAppInboundInteractiveOptions = {
  bookingFlowId?: string;
  bookingFlowCta?: string;
  bookingFlowScreen?: string;
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

    const sendResult = await this.sendWorkflowResultOrMarkReadyForRetry(message, workflowResult);

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

    const sendResult = await this.sendWorkflowResultOrMarkReadyForRetry(message, {
      kind: delivery.workflowResult,
      text: delivery.responseText
    });

    await this.markProcessedWebhookDelivery(message, sendResult.providerMessageId);
    await this.auditOutboundSent(message, delivery.workflowResult, sendResult.providerMessageId);

    return {
      status: "sent",
      workflowResult: delivery.workflowResult,
      providerMessageId: sendResult.providerMessageId
    };
  }

  private async sendWorkflowResultOrMarkReadyForRetry(
    message: NormalizedWhatsAppInboundMessage,
    workflowResult: WorkflowResult
  ) {
    try {
      return await this.sendWorkflowResult(message, workflowResult);
    } catch (error) {
      await this.markWebhookDeliveryReadyForRetry(message);
      await this.auditOutboundFailed(message);
      throw error;
    }
  }

  private async sendWorkflowResult(message: NormalizedWhatsAppInboundMessage, workflowResult: WorkflowResult) {
    const interaction = await this.buildBookingInteraction(message, workflowResult);
    if (interaction) {
      return await this.options.provider.sendInteractive(interaction);
    }

    return await this.options.provider.sendText({
      clinicId: message.clinicId,
      to: message.whatsappNumber,
      text: workflowResult.text
    });
  }

  private async buildBookingInteraction(
    message: NormalizedWhatsAppInboundMessage,
    workflowResult: WorkflowResult
  ): Promise<SendInteractiveMessageInput | undefined> {
    if (workflowResult.kind !== "reply" || !isEligibleBookingInteractionText(workflowResult.text)) {
      return undefined;
    }

    const conversation = await this.options.repos.getConversation({
      clinicId: message.clinicId,
      conversationId: message.conversationId
    });
    if (!conversation?.pendingBooking) {
      return undefined;
    }

    if (this.options.interactive?.bookingFlowId) {
      return buildBookingFlowMessage({
        message,
        conversation,
        pendingBooking: conversation.pendingBooking,
        bodyText: workflowResult.text,
        flowId: this.options.interactive.bookingFlowId,
        flowCta: this.options.interactive.bookingFlowCta ?? "Ver turnos",
        screen: this.options.interactive.bookingFlowScreen ?? "BOOKING"
      });
    }

    return {
      clinicId: message.clinicId,
      to: message.whatsappNumber,
      kind: "button",
      bodyText: workflowResult.text,
      buttons: [
        { id: "booking_confirm", title: "Confirmar" },
        { id: "booking_change", title: "Otro horario" },
        { id: "booking_handoff", title: "Recepcion" }
      ]
    };
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

function buildBookingFlowMessage(input: {
  message: NormalizedWhatsAppInboundMessage;
  conversation: Conversation;
  pendingBooking: PendingBooking;
  bodyText: string;
  flowId: string;
  flowCta: string;
  screen: string;
}): SendInteractiveMessageInput {
  return {
    clinicId: input.message.clinicId,
    to: input.message.whatsappNumber,
    kind: "flow",
    bodyText: input.bodyText,
    flowId: input.flowId,
    flowCta: limitFlowCta(input.flowCta),
    flowAction: "navigate",
    flowToken: buildFlowToken(input.message),
    flowActionPayload: {
      screen: input.screen,
      data: {
        appointmentId: input.pendingBooking.appointmentId ?? "",
        conversationId: input.conversation.id,
        serviceId: input.pendingBooking.serviceId,
        professionalId: input.pendingBooking.professionalId,
        startsAt: input.pendingBooking.startsAt.toISOString(),
        endsAt: input.pendingBooking.endsAt.toISOString(),
        slotLockId: input.pendingBooking.slotLockId ?? ""
      }
    }
  };
}

function buildFlowToken(message: NormalizedWhatsAppInboundMessage) {
  return `${message.clinicId}:${message.conversationId}:${message.providerMessageId}`
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 200);
}

function limitFlowCta(flowCta: string) {
  const trimmed = flowCta.trim();
  if (trimmed.length <= 20) {
    return trimmed || "Ver turnos";
  }
  return trimmed.slice(0, 20).trimEnd() || "Ver turnos";
}

function isEligibleBookingInteractionText(text: string) {
  const normalized = normalizeForInteraction(text);
  if (!normalized) {
    return false;
  }

  return !(
    normalized.includes("nombre y apellido") ||
    normalized.includes("pasame nombre") ||
    normalized.includes("turno confirmado") ||
    normalized.includes("turno reprogramado") ||
    normalized.includes("turno cancelado") ||
    normalized.includes("no encontre ese tratamiento") ||
    normalized.includes("no pude encontrar el tratamiento")
  );
}

function normalizeForInteraction(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
