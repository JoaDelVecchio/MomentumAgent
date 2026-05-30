export type NormalizedWhatsAppInboundMessage = {
  clinicId: string;
  providerPhoneNumberId: string;
  providerMessageId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
  idempotencyKey: string;
  receivedAt: Date;
};

export type SendTextMessageInput = {
  clinicId: string;
  to: string;
  text: string;
};

export type SendTemplateMessageInput = {
  clinicId: string;
  to: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
};

export type SendMessageResult = {
  providerMessageId: string;
};

export class WhatsAppProviderError extends Error {
  readonly statusCode?: number;

  constructor(message: string, options: { statusCode?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "WhatsAppProviderError";
    this.statusCode = options.statusCode;
  }
}

export interface WhatsAppProvider {
  sendText(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendTemplate(input: SendTemplateMessageInput): Promise<SendMessageResult>;
}
