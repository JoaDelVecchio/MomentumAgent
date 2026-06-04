import {
  type SendInteractiveMessageInput,
  type SendMessageResult,
  type SendTemplateMessageInput,
  type SendTextMessageInput,
  type WhatsAppProvider,
  WhatsAppProviderError
} from "../../ports/messaging.js";

export type SentTextMessage = SendTextMessageInput & {
  providerMessageId: string;
};

export type SentTemplateMessage = SendTemplateMessageInput & {
  providerMessageId: string;
};

export type SentInteractiveMessage = SendInteractiveMessageInput & {
  providerMessageId: string;
};

export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly sentTextMessages: SentTextMessage[] = [];
  readonly sentTemplateMessages: SentTemplateMessage[] = [];
  readonly sentInteractiveMessages: SentInteractiveMessage[] = [];

  private counter = 0;
  private nextErrorMessage?: string;

  async sendText(input: SendTextMessageInput): Promise<SendMessageResult> {
    this.throwIfNextSendShouldFail();
    const providerMessageId = this.nextProviderMessageId();
    this.sentTextMessages.push({ ...input, providerMessageId });
    return { providerMessageId };
  }

  async sendTemplate(input: SendTemplateMessageInput): Promise<SendMessageResult> {
    this.throwIfNextSendShouldFail();
    const providerMessageId = this.nextProviderMessageId();
    this.sentTemplateMessages.push({
      ...input,
      parameters: [...input.parameters],
      providerMessageId
    });
    return { providerMessageId };
  }

  async sendInteractive(input: SendInteractiveMessageInput): Promise<SendMessageResult> {
    this.throwIfNextSendShouldFail();
    const providerMessageId = this.nextProviderMessageId();
    this.sentInteractiveMessages.push({ ...cloneInteractiveInput(input), providerMessageId });
    return { providerMessageId };
  }

  failNextSend(message = "WhatsApp provider failed") {
    this.nextErrorMessage = message;
  }

  private throwIfNextSendShouldFail() {
    if (!this.nextErrorMessage) {
      return;
    }

    const message = this.nextErrorMessage;
    this.nextErrorMessage = undefined;
    throw new WhatsAppProviderError(message);
  }

  private nextProviderMessageId() {
    this.counter += 1;
    return `msg_${this.counter}`;
  }
}

function cloneInteractiveInput(input: SendInteractiveMessageInput): SendInteractiveMessageInput {
  if (input.kind === "button") {
    return {
      ...input,
      buttons: input.buttons.map((button) => ({ ...button }))
    };
  }

  if (input.kind === "list") {
    return {
      ...input,
      sections: input.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => ({ ...row }))
      }))
    };
  }

  return {
    ...input,
    flowActionPayload: input.flowActionPayload
      ? {
          ...input.flowActionPayload,
          data: input.flowActionPayload.data ? { ...input.flowActionPayload.data } : undefined
        }
      : undefined
  };
}
