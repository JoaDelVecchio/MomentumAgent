import type {
  SendInteractiveMessageInput,
  SendMessageResult,
  SendTemplateMessageInput,
  SendTextMessageInput,
  WhatsAppProvider
} from "../../../ports/messaging.js";
import { WhatsAppProviderError } from "../../../ports/messaging.js";
import { KapsoSendMessageResponseSchema } from "./types.js";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type KapsoWhatsAppProviderConfig = {
  apiKey: string;
  phoneNumberId: string;
  baseUrl?: string;
  fetch?: Fetch;
};

export class KapsoWhatsAppProvider implements WhatsAppProvider {
  private readonly baseUrl: string;
  private readonly fetch: Fetch;

  constructor(private readonly config: KapsoWhatsAppProviderConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.kapso.ai/meta/whatsapp";
    this.fetch = config.fetch ?? fetch;
  }

  async sendText(input: SendTextMessageInput): Promise<SendMessageResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.text }
    });
  }

  async sendTemplate(input: SendTemplateMessageInput): Promise<SendMessageResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components: input.parameters.length
          ? [
              {
                type: "body",
                parameters: input.parameters.map((parameter) => ({
                  type: "text",
                  text: parameter
                }))
              }
            ]
          : undefined
      }
    });
  }

  async sendInteractive(input: SendInteractiveMessageInput): Promise<SendMessageResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "interactive",
      interactive: buildInteractiveMessagePayload(input)
    });
  }

  private async send(payload: unknown): Promise<SendMessageResult> {
    let response: Response;
    try {
      response = await this.fetch(this.messageEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new WhatsAppProviderError("Kapso send failed", { cause: error });
    }

    const responseBody = await readJsonResponse(response);
    if (!response.ok) {
      throw new WhatsAppProviderError(`Kapso send failed: ${extractKapsoErrorMessage(responseBody)}`, {
        statusCode: response.status
      });
    }

    const parsed = KapsoSendMessageResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new WhatsAppProviderError("Kapso send failed: invalid response payload", {
        statusCode: response.status,
        cause: parsed.error
      });
    }

    return { providerMessageId: parsed.data.messages[0].id };
  }

  private messageEndpoint() {
    return `${this.baseUrl.replace(/\/$/, "")}/v24.0/${this.config.phoneNumberId}/messages`;
  }
}

function buildInteractiveMessagePayload(input: SendInteractiveMessageInput) {
  const base = {
    body: { text: input.bodyText },
    ...(input.footerText ? { footer: { text: input.footerText } } : {})
  };

  if (input.kind === "button") {
    return {
      type: "button",
      ...base,
      action: {
        buttons: input.buttons.map((button) => ({
          type: "reply",
          reply: {
            id: button.id,
            title: button.title
          }
        }))
      }
    };
  }

  if (input.kind === "list") {
    return {
      type: "list",
      ...base,
      action: {
        button: input.buttonText,
        sections: input.sections.map((section) => ({
          ...(section.title ? { title: section.title } : {}),
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            ...(row.description ? { description: row.description } : {})
          }))
        }))
      }
    };
  }

  return {
    type: "flow",
    ...base,
    action: {
      name: "flow",
      parameters: {
        flow_message_version: input.flowMessageVersion ?? "3",
        ...(input.flowToken ? { flow_token: input.flowToken } : {}),
        flow_id: input.flowId,
        flow_cta: input.flowCta,
        flow_action: input.flowAction ?? "navigate",
        ...(input.flowActionPayload ? { flow_action_payload: input.flowActionPayload } : {})
      }
    }
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
}

function extractKapsoErrorMessage(body: unknown) {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return "unknown error";
}
