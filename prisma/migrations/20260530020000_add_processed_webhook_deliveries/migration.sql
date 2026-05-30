CREATE TABLE "ProcessedWebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "providerMessageId" TEXT,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedWebhookDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProcessedWebhookDelivery_provider_idempotencyKey_key" ON "ProcessedWebhookDelivery"("provider", "idempotencyKey");
CREATE INDEX "ProcessedWebhookDelivery_clinicId_processedAt_idx" ON "ProcessedWebhookDelivery"("clinicId", "processedAt");
