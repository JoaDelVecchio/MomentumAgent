import { z } from "zod";
import type { NormalizedWhatsAppInboundMessage } from "../../../ports/messaging.js";

export const KapsoSendMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1)
});

export type KapsoSendMessageResponse = z.infer<typeof KapsoSendMessageResponseSchema>;

const KapsoWhatsAppReceivedMessageSchema = z.object({
  event: z.literal("whatsapp.message.received").optional(),
  phone_number_id: z.string().min(1).optional(),
  message: z.object({
    id: z.string().min(1),
    type: z.literal("text"),
    from: z.string().min(1).optional(),
    from_user_id: z.string().min(1).optional(),
    kapso: z.object({
      content: z.string().min(1)
    })
  }),
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
    text: payload.message.kapso.content,
    idempotencyKey: input.idempotencyKey ?? payload.message.id,
    receivedAt: input.receivedAt ?? new Date()
  };
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
