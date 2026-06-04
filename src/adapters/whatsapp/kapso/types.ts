import { z } from "zod";
import type { NormalizedWhatsAppInboundMessage } from "../../../ports/messaging.js";

export const KapsoSendMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1)
});

export type KapsoSendMessageResponse = z.infer<typeof KapsoSendMessageResponseSchema>;

const KapsoInboundInteractiveReplySchema = z
  .object({
    type: z.string().min(1).optional(),
    button_reply: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1)
      })
      .passthrough()
      .optional(),
    list_reply: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional()
      })
      .passthrough()
      .optional(),
    nfm_reply: z
      .object({
        name: z.string().optional(),
        body: z.string().optional(),
        response_json: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const KapsoInboundMessageMetadataSchema = z
  .object({
    content: z.string().min(1).optional(),
    flow_response: z.record(z.unknown()).optional(),
    flow_token: z.string().optional(),
    flow_name: z.string().optional()
  })
  .passthrough();

const KapsoWhatsAppReceivedMessageSchema = z.object({
  event: z.literal("whatsapp.message.received").optional(),
  phone_number_id: z.string().min(1).optional(),
  message: z
    .object({
      id: z.string().min(1),
      type: z.string().min(1),
      from: z.string().min(1).optional(),
      from_user_id: z.string().min(1).optional(),
      text: z
        .object({
          body: z.string().min(1).optional()
        })
        .passthrough()
        .optional(),
      interactive: KapsoInboundInteractiveReplySchema.optional(),
      button: z
        .object({
          payload: z.string().min(1).optional(),
          text: z.string().min(1).optional()
        })
        .passthrough()
        .optional(),
      kapso: KapsoInboundMessageMetadataSchema.optional()
    })
    .passthrough(),
  conversation: z.object({
    id: z.string().min(1),
    phone_number: z.string().min(1).optional(),
    business_scoped_user_id: z.string().min(1).optional(),
    phone_number_id: z.string().min(1).optional()
  })
});

export type KapsoWhatsAppReceivedMessage = z.infer<typeof KapsoWhatsAppReceivedMessageSchema>;

export class KapsoWebhookPayloadError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "KapsoWebhookPayloadError";
  }
}

export type NormalizeKapsoInboundMessageInput = {
  clinicId: string;
  payload: unknown;
  idempotencyKey?: string;
  receivedAt?: Date;
};

export function normalizeKapsoInboundMessage(
  input: NormalizeKapsoInboundMessageInput
): NormalizedWhatsAppInboundMessage {
  const parsed = KapsoWhatsAppReceivedMessageSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new KapsoWebhookPayloadError("Invalid Kapso WhatsApp webhook payload", {
      cause: parsed.error
    });
  }

  const payload = parsed.data;
  const messageText = extractMessageText(payload);
  if (!messageText) {
    throw new KapsoWebhookPayloadError("Kapso WhatsApp webhook payload is missing supported message content");
  }

  const recipientIdentity = getRecipientIdentity(payload);
  const providerPhoneNumberId = payload.phone_number_id ?? payload.conversation.phone_number_id;
  if (!providerPhoneNumberId) {
    throw new KapsoWebhookPayloadError("Kapso WhatsApp webhook payload is missing phone_number_id");
  }

  return {
    clinicId: input.clinicId,
    providerPhoneNumberId,
    providerMessageId: payload.message.id,
    conversationId: payload.conversation.id,
    patientId: getPatientId(payload),
    whatsappNumber: recipientIdentity,
    text: messageText,
    idempotencyKey: input.idempotencyKey ?? payload.message.id,
    receivedAt: input.receivedAt ?? new Date()
  };
}

function extractMessageText(payload: KapsoWhatsAppReceivedMessage) {
  if (payload.message.type === "interactive" && payload.message.interactive) {
    const interactiveText = extractInteractiveMessageText(payload.message.interactive, payload.message.kapso);
    if (interactiveText) {
      return interactiveText;
    }
  }

  const legacyButtonCommand = commandForActionId(payload.message.button?.payload);
  if (legacyButtonCommand) {
    return legacyButtonCommand;
  }

  return cleanMessageText(
    payload.message.kapso?.content ?? payload.message.text?.body ?? payload.message.button?.text
  );
}

function extractInteractiveMessageText(
  interactive: NonNullable<KapsoWhatsAppReceivedMessage["message"]["interactive"]>,
  kapso: KapsoWhatsAppReceivedMessage["message"]["kapso"]
) {
  if (interactive.button_reply) {
    return commandForActionId(interactive.button_reply.id) ?? cleanMessageText(interactive.button_reply.title);
  }

  if (interactive.list_reply) {
    return commandForActionId(interactive.list_reply.id) ?? cleanMessageText(interactive.list_reply.title);
  }

  if (interactive.nfm_reply) {
    const flowResponse = kapso?.flow_response ?? parseFlowResponse(interactive.nfm_reply.response_json);
    const flowCommand = commandForFlowResponse(flowResponse);
    return flowCommand ?? cleanMessageText(interactive.nfm_reply.body ?? kapso?.content);
  }

  return undefined;
}

function parseFlowResponse(responseJson: string | undefined) {
  if (!responseJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function commandForFlowResponse(response: Record<string, unknown> | undefined) {
  if (!response) {
    return undefined;
  }

  return (
    commandForActionId(response.action) ??
    commandForActionId(response.intent) ??
    commandForActionId(response.selected_action) ??
    commandForActionId(response.selectedAction)
  );
}

function commandForActionId(actionId: unknown) {
  if (typeof actionId !== "string") {
    return undefined;
  }

  const normalized = actionId.trim().toLowerCase();
  const commands: Record<string, string> = {
    booking_confirm: "confirmo",
    confirm_booking: "confirmo",
    confirm: "confirmo",
    booking_change: "otro horario",
    change_slot: "otro horario",
    another_slot: "otro horario",
    booking_handoff: "hablar con recepcion",
    handoff: "hablar con recepcion",
    human: "hablar con recepcion",
    reception: "hablar con recepcion"
  };

  return commands[normalized];
}

function cleanMessageText(text: unknown) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() || undefined : undefined;
}

function getRecipientIdentity(payload: KapsoWhatsAppReceivedMessage) {
  return (
    payload.conversation.phone_number ??
    payload.message.from ??
    payload.conversation.business_scoped_user_id ??
    payload.message.from_user_id ??
    payload.conversation.id
  );
}

function getPatientId(payload: KapsoWhatsAppReceivedMessage) {
  const phone = payload.conversation.phone_number ?? payload.message.from;
  if (phone) {
    return `whatsapp:${phone}`;
  }

  const businessScopedUserId = payload.conversation.business_scoped_user_id ?? payload.message.from_user_id;
  if (businessScopedUserId) {
    return `bsuid:${businessScopedUserId}`;
  }

  return `kapso-conversation:${payload.conversation.id}`;
}
