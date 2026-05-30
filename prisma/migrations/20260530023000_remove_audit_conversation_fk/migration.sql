PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_AuditEvent" ("id", "clinicId", "conversationId", "type", "message", "metadataJson", "createdAt")
SELECT "id", "clinicId", "conversationId", "type", "message", "metadataJson", "createdAt" FROM "AuditEvent";

DROP TABLE "AuditEvent";

ALTER TABLE "new_AuditEvent" RENAME TO "AuditEvent";

CREATE INDEX "AuditEvent_clinicId_createdAt_idx" ON "AuditEvent"("clinicId", "createdAt");
CREATE INDEX "AuditEvent_conversationId_createdAt_idx" ON "AuditEvent"("conversationId", "createdAt");
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
