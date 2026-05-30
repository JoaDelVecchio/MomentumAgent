import {
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

export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly sentTextMessages: SentTextMessage[] = [];
  readonly sentTemplateMessages: SentTemplateMessage[] = [];

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
