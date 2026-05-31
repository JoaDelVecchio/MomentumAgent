import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationControlService } from "../src/application/conversations/conversation-control-service.js";
import type { AuditEventInput } from "../src/ports/audit-log.js";
import type { Conversation } from "../src/ports/repositories.js";

describe("ConversationControlService", () => {
  it("pauses and resumes an existing conversation with audit events", async () => {
    const now = new Date("2026-06-01T15:30:00.000Z");
    const repos = new InMemoryRepositories();
    const audit = new InMemoryAuditLog();
    const service = new ConversationControlService({ repos, audit, now: () => now });
    repos.saveConversation(conversationFixture({ botPaused: false }));

    const paused = await service.pauseConversation({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      reason: "operator_handoff"
    });
    const resumed = await service.resumeConversation({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      reason: "operator_handoff"
    });

    expect(paused).toEqual(expect.objectContaining({ id: "conv_1", clinicId: "clinic_1", botPaused: true, updatedAt: now }));
    expect(resumed).toEqual(expect.objectContaining({ id: "conv_1", clinicId: "clinic_1", botPaused: false, updatedAt: now }));
    expect(await repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).toEqual(
      expect.objectContaining({ botPaused: false, updatedAt: now })
    );
    await expect(audit.list()).resolves.toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "conversation.bot_paused",
        message: "Paused bot for conversation",
        metadata: { reason: "operator_handoff" }
      }),
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "conversation.bot_resumed",
        message: "Resumed bot for conversation",
        metadata: { reason: "operator_handoff" }
      })
    ]);
  });

  it("throws when the conversation is missing", async () => {
    const service = new ConversationControlService({
      repos: new InMemoryRepositories(),
      audit: new InMemoryAuditLog()
    });

    await expect(
      service.pauseConversation({ clinicId: "clinic_1", conversationId: "missing", reason: "operator_handoff" })
    ).rejects.toThrow("Conversation clinic_1:missing not found");
  });

  it("pauses conversations inside the conversation lock", async () => {
    const repos = new RecordingLockRepository();
    const audit = new RecordingAuditLog(() => repos.lockDepth > 0);
    const service = new ConversationControlService({ repos, audit });
    repos.saveConversation(conversationFixture({ botPaused: false }));

    await service.pauseConversation({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      reason: "operator_handoff"
    });

    expect(repos.lockKeys).toEqual(["clinic_1:conv_1"]);
    expect(repos.saveInsideLock).toEqual([false, true]);
    expect(audit.recordInsideLock).toEqual([true]);
  });
});

function conversationFixture(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: false,
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    ...overrides
  };
}

class RecordingLockRepository extends InMemoryRepositories {
  lockKeys: string[] = [];
  lockDepth = 0;
  saveInsideLock: boolean[] = [];

  override saveConversation(conversation: Conversation) {
    this.saveInsideLock.push(this.lockDepth > 0);
    return super.saveConversation(conversation);
  }

  override async withConversationLock<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    this.lockKeys.push(conversationId);
    this.lockDepth += 1;
    try {
      return await super.withConversationLock(conversationId, operation);
    } finally {
      this.lockDepth -= 1;
    }
  }
}

class RecordingAuditLog extends InMemoryAuditLog {
  recordInsideLock: boolean[] = [];

  constructor(private readonly isInsideLock: () => boolean) {
    super();
  }

  override async record(input: AuditEventInput) {
    this.recordInsideLock.push(this.isInsideLock());
    return super.record(input);
  }
}
