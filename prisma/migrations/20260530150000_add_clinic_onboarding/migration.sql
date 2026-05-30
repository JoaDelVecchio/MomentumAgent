ALTER TABLE "Clinic" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'presencial';
ALTER TABLE "Clinic" ADD COLUMN "lifecycleState" TEXT NOT NULL DEFAULT 'setup';
ALTER TABLE "Clinic" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "Clinic" ADD COLUMN "primaryContactName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Clinic" ADD COLUMN "primaryContactPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Clinic" ADD COLUMN "city" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Clinic" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'Argentina';
ALTER TABLE "Clinic" ADD COLUMN "whatsappReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "calendarConnected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "testConversationPassed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "activationChecklistCompleted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClinicLead" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contactName" TEXT NOT NULL,
  "clinicName" TEXT NOT NULL,
  "whatsappOrPhone" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "professionalCount" INTEGER NOT NULL,
  "currentSchedulingSystem" TEXT NOT NULL,
  "monthlyWhatsappInquiries" TEXT NOT NULL,
  "mainPain" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "convertedClinicId" TEXT,
  "submittedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClinicLead_convertedClinicId_fkey" FOREIGN KEY ("convertedClinicId") REFERENCES "Clinic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "Clinic" ADD COLUMN "leadId" TEXT REFERENCES "ClinicLead" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ClinicKnowledge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clinicId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClinicKnowledge_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Clinic_lifecycleState_paymentStatus_updatedAt_idx" ON "Clinic"("lifecycleState", "paymentStatus", "updatedAt");
CREATE INDEX "Clinic_source_updatedAt_idx" ON "Clinic"("source", "updatedAt");
CREATE INDEX "Clinic_leadId_idx" ON "Clinic"("leadId");
CREATE INDEX "ClinicLead_submittedAt_idx" ON "ClinicLead"("submittedAt");
CREATE INDEX "ClinicLead_status_submittedAt_idx" ON "ClinicLead"("status", "submittedAt");
CREATE INDEX "ClinicLead_source_submittedAt_idx" ON "ClinicLead"("source", "submittedAt");
CREATE INDEX "ClinicLead_convertedClinicId_idx" ON "ClinicLead"("convertedClinicId");
CREATE INDEX "ClinicKnowledge_clinicId_category_question_idx" ON "ClinicKnowledge"("clinicId", "category", "question");
