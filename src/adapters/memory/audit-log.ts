import type { AuditEvent, AuditEventInput, AuditLogPort } from "../../ports/audit-log.js";

export class InMemoryAuditLog implements AuditLogPort {
  private events: AuditEvent[] = [];
  private counter = 0;

  async record(input: AuditEventInput): Promise<AuditEvent> {
    this.counter += 1;
    const event: AuditEvent = {
      ...cloneAuditEventInput(input),
      id: `audit_${this.counter}`,
      createdAt: new Date()
    };
    this.events.push(event);
    return cloneAuditEvent(event);
  }

  async list(): Promise<AuditEvent[]> {
    return this.events.map((event) => cloneAuditEvent(event));
  }
}

function cloneAuditEventInput(input: AuditEventInput): AuditEventInput {
  return {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    type: input.type,
    message: input.message,
    metadata: { ...input.metadata }
  };
}

function cloneAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...cloneAuditEventInput(event),
    id: event.id,
    createdAt: new Date(event.createdAt)
  };
}
