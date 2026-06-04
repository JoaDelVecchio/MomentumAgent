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

export type WhatsAppInteractiveButton = {
  id: string;
  title: string;
};

export type WhatsAppInteractiveListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractiveListSection = {
  title?: string;
  rows: WhatsAppInteractiveListRow[];
};

type SendInteractiveBaseInput = {
  clinicId: string;
  to: string;
  bodyText: string;
  footerText?: string;
};

export type SendInteractiveButtonMessageInput = SendInteractiveBaseInput & {
  kind: "button";
  buttons: WhatsAppInteractiveButton[];
};

export type SendInteractiveListMessageInput = SendInteractiveBaseInput & {
  kind: "list";
  buttonText: string;
  sections: WhatsAppInteractiveListSection[];
};

export type SendInteractiveFlowMessageInput = SendInteractiveBaseInput & {
  kind: "flow";
  flowId: string;
  flowCta: string;
  flowToken?: string;
  flowMessageVersion?: "3";
  flowAction?: "navigate" | "data_exchange";
  flowActionPayload?: {
    screen?: string;
    data?: Record<string, unknown>;
  };
};

export type SendInteractiveMessageInput =
  | SendInteractiveButtonMessageInput
  | SendInteractiveListMessageInput
  | SendInteractiveFlowMessageInput;

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
  sendInteractive(input: SendInteractiveMessageInput): Promise<SendMessageResult>;
}
