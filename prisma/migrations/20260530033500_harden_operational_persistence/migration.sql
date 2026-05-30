PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "WhatsAppOptOut" (
    "whatsappNumber" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "pendingBookingJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("clinicId", "id"),
    CONSTRAINT "Conversation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Conversation" ("id", "clinicId", "patientId", "botPaused", "pendingBookingJson", "createdAt", "updatedAt")
SELECT "id", "clinicId", "patientId", "botPaused", "pendingBookingJson", "createdAt", "updatedAt" FROM "Conversation";

DROP TABLE "Conversation";

ALTER TABLE "new_Conversation" RENAME TO "Conversation";

CREATE INDEX "Conversation_clinicId_updatedAt_idx" ON "Conversation"("clinicId", "updatedAt");
CREATE INDEX "Conversation_patientId_idx" ON "Conversation"("patientId");
CREATE INDEX "Conversation_id_idx" ON "Conversation"("id");

ALTER TABLE "ProcessedWebhookDelivery" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'processed';
ALTER TABLE "ProcessedWebhookDelivery" ADD COLUMN "responseText" TEXT;
ALTER TABLE "ProcessedWebhookDelivery" ADD COLUMN "workflowResult" TEXT;
ALTER TABLE "ProcessedWebhookDelivery" ADD COLUMN "outboundProviderMessageId" TEXT;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
