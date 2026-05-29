export type AuditEventInput = {
  clinicId: string;
  conversationId?: string;
  type: string;
  message: string;
  metadata: Record<string, string>;
};

export type AuditEvent = AuditEventInput & {
  id: string;
  createdAt: Date;
};

export interface AuditLogPort {
  record(input: AuditEventInput): Promise<AuditEvent>;
}
