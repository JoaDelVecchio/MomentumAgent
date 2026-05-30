import type { InMemoryRepositories } from "../../adapters/memory/repositories.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { SendTemplateMessageInput, WhatsAppProvider } from "../../ports/messaging.js";

export type OutboundTemplateServiceOptions = {
  repos: InMemoryRepositories;
  provider: WhatsAppProvider;
  audit: AuditLogPort;
};

export type OutboundTemplateResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "blocked_opt_out" };

export class OutboundTemplateService {
  constructor(private readonly options: OutboundTemplateServiceOptions) {}

  async sendApprovedTemplate(input: SendTemplateMessageInput): Promise<OutboundTemplateResult> {
    if (this.options.repos.isOptedOut(input.to)) {
      await this.options.audit.record({
        clinicId: input.clinicId,
        type: "whatsapp.template.blocked",
        message: "Blocked WhatsApp template because recipient opted out",
        metadata: {
          to: input.to,
          templateName: input.templateName,
          reason: "opt_out"
        }
      });
      return { status: "blocked_opt_out" };
    }

    try {
      const result = await this.options.provider.sendTemplate(input);
      await this.options.audit.record({
        clinicId: input.clinicId,
        type: "whatsapp.template.sent",
        message: "Sent approved WhatsApp template",
        metadata: {
          to: input.to,
          templateName: input.templateName,
          providerMessageId: result.providerMessageId
        }
      });
      return { status: "sent", providerMessageId: result.providerMessageId };
    } catch (error) {
      await this.options.audit.record({
        clinicId: input.clinicId,
        type: "whatsapp.template.failed",
        message: "Failed to send approved WhatsApp template",
        metadata: {
          to: input.to,
          templateName: input.templateName
        }
      });
      throw error;
    }
  }
}
