import type { AuditLogPort } from "../../ports/audit-log.js";
import type { Conversation, OperationalRepository } from "../../ports/repositories.js";

export type ConversationControlInput = {
  clinicId: string;
  conversationId: string;
  reason: string;
};

export type ConversationControlServiceOptions = {
  repos: OperationalRepository;
  audit: AuditLogPort;
  now?: () => Date;
};

export class ConversationControlService {
  private readonly repos: OperationalRepository;
  private readonly audit: AuditLogPort;
  private readonly now: () => Date;

  constructor(options: ConversationControlServiceOptions) {
    this.repos = options.repos;
    this.audit = options.audit;
    this.now = options.now ?? (() => new Date());
  }

  async pauseConversation(input: ConversationControlInput): Promise<Conversation> {
    return this.setPaused(input, true);
  }

  async resumeConversation(input: ConversationControlInput): Promise<Conversation> {
    return this.setPaused(input, false);
  }

  private async setPaused(input: ConversationControlInput, botPaused: boolean): Promise<Conversation> {
    return this.repos.withConversationLock(`${input.clinicId}:${input.conversationId}`, async () => {
      const conversation = await this.repos.getConversation({
        clinicId: input.clinicId,
        conversationId: input.conversationId
      });
      if (!conversation) {
        throw new Error(`Conversation ${input.clinicId}:${input.conversationId} not found`);
      }

      const updated: Conversation = {
        ...conversation,
        botPaused,
        updatedAt: this.now()
      };
      await this.repos.saveConversation(updated);
      await this.audit.record({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        type: botPaused ? "conversation.bot_paused" : "conversation.bot_resumed",
        message: botPaused ? "Paused bot for conversation" : "Resumed bot for conversation",
        metadata: { reason: input.reason }
      });
      return updated;
    });
  }
}
