import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditEventInput, AuditLogPort } from "../../ports/audit-log.js";

type AuditEventRecord = {
  id: string;
  clinicId: string;
  conversationId: string | null;
  type: string;
  message: string;
  metadataJson: string;
  createdAt: Date;
};

export class PrismaAuditLog implements AuditLogPort {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event = await this.prisma.auditEvent.create({
      data: {
        id: randomUUID(),
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        type: input.type,
        message: input.message,
        metadataJson: JSON.stringify(input.metadata)
      }
    });

    return toAuditEvent(event);
  }
}

function toAuditEvent(event: AuditEventRecord): AuditEvent {
  return {
    id: event.id,
    clinicId: event.clinicId,
    conversationId: event.conversationId ?? undefined,
    type: event.type,
    message: event.message,
    metadata: parseMetadata(event.metadataJson),
    createdAt: event.createdAt
  };
}

function parseMetadata(metadataJson: string): Record<string, string> {
  const metadata = JSON.parse(metadataJson) as unknown;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.values(metadata).some((value) => typeof value !== "string")
  ) {
    throw new Error("Invalid audit event metadata");
  }
  return { ...(metadata as Record<string, string>) };
}
