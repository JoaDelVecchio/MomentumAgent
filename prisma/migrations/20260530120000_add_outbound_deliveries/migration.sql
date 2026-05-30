CREATE TABLE "OutboundDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "automationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "toWhatsappNumber" TEXT NOT NULL,
    "patientId" TEXT,
    "conversationId" TEXT,
    "appointmentId" TEXT,
    "templateName" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "claimedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "blockedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutboundDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OutboundDelivery_deliveryKey_key" ON "OutboundDelivery"("deliveryKey");
CREATE INDEX "OutboundDelivery_clinicId_automationType_status_idx" ON "OutboundDelivery"("clinicId", "automationType", "status");
CREATE INDEX "OutboundDelivery_patientId_idx" ON "OutboundDelivery"("patientId");
CREATE INDEX "OutboundDelivery_conversationId_idx" ON "OutboundDelivery"("conversationId");
CREATE INDEX "OutboundDelivery_appointmentId_idx" ON "OutboundDelivery"("appointmentId");
CREATE INDEX "OutboundDelivery_toWhatsappNumber_idx" ON "OutboundDelivery"("toWhatsappNumber");
