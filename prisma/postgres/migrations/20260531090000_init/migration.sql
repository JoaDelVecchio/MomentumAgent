-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "minimumNoticeMinutes" INTEGER NOT NULL,
    "cancellationNoticeMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL,
    "requiredPatientFieldsJson" TEXT NOT NULL,
    "leadId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'presencial',
    "lifecycleState" TEXT NOT NULL DEFAULT 'setup',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "primaryContactName" TEXT NOT NULL DEFAULT '',
    "primaryContactPhone" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'Argentina',
    "whatsappReady" BOOLEAN NOT NULL DEFAULT false,
    "calendarConnected" BOOLEAN NOT NULL DEFAULT false,
    "testConversationPassed" BOOLEAN NOT NULL DEFAULT false,
    "activationChecklistCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicLead" (
    "id" TEXT NOT NULL,
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
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicKnowledge" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceText" TEXT NOT NULL,
    "preparation" TEXT NOT NULL,
    "restrictionsJson" TEXT NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("clinicId","id")
);

-- CreateTable
CREATE TABLE "Professional" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "workingHoursJson" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "Professional_pkey" PRIMARY KEY ("clinicId","id")
);

-- CreateTable
CREATE TABLE "ServiceProfessional" (
    "clinicId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,

    CONSTRAINT "ServiceProfessional_pkey" PRIMARY KEY ("clinicId","serviceId","professionalId")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "fullName" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppOptOut" (
    "whatsappNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppOptOut_pkey" PRIMARY KEY ("whatsappNumber")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "pendingBookingJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("clinicId","id")
);

-- CreateTable
CREATE TABLE "PatientInterest" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT,
    "preferredFrom" TIMESTAMP(3) NOT NULL,
    "preferredTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactivationAttempt" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT,

    CONSTRAINT "ReactivationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountEmail" TEXT,
    "scopesJson" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookDelivery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "responseText" TEXT,
    "workflowResult" TEXT,
    "outboundProviderMessageId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundDelivery" (
    "id" TEXT NOT NULL,
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
    "claimedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Clinic_lifecycleState_paymentStatus_updatedAt_idx" ON "Clinic"("lifecycleState", "paymentStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "Clinic_source_updatedAt_idx" ON "Clinic"("source", "updatedAt");

-- CreateIndex
CREATE INDEX "Clinic_leadId_idx" ON "Clinic"("leadId");

-- CreateIndex
CREATE INDEX "ClinicLead_submittedAt_idx" ON "ClinicLead"("submittedAt");

-- CreateIndex
CREATE INDEX "ClinicLead_status_submittedAt_idx" ON "ClinicLead"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ClinicLead_source_submittedAt_idx" ON "ClinicLead"("source", "submittedAt");

-- CreateIndex
CREATE INDEX "ClinicLead_convertedClinicId_idx" ON "ClinicLead"("convertedClinicId");

-- CreateIndex
CREATE INDEX "ClinicKnowledge_clinicId_category_question_idx" ON "ClinicKnowledge"("clinicId", "category", "question");

-- CreateIndex
CREATE INDEX "Service_clinicId_idx" ON "Service"("clinicId");

-- CreateIndex
CREATE INDEX "Professional_clinicId_idx" ON "Professional"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Professional_clinicId_calendarId_key" ON "Professional"("clinicId", "calendarId");

-- CreateIndex
CREATE INDEX "ServiceProfessional_professionalId_idx" ON "ServiceProfessional"("professionalId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_whatsappNumber_key" ON "Patient"("whatsappNumber");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_startsAt_idx" ON "Appointment"("clinicId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_status_idx" ON "Appointment"("patientId", "status");

-- CreateIndex
CREATE INDEX "Appointment_serviceId_idx" ON "Appointment"("serviceId");

-- CreateIndex
CREATE INDEX "Appointment_professionalId_startsAt_idx" ON "Appointment"("professionalId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_calendarEventId_key" ON "Appointment"("calendarEventId");

-- CreateIndex
CREATE INDEX "Conversation_clinicId_updatedAt_idx" ON "Conversation"("clinicId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_patientId_idx" ON "Conversation"("patientId");

-- CreateIndex
CREATE INDEX "Conversation_id_idx" ON "Conversation"("id");

-- CreateIndex
CREATE INDEX "PatientInterest_clinicId_status_preferredFrom_idx" ON "PatientInterest"("clinicId", "status", "preferredFrom");

-- CreateIndex
CREATE INDEX "PatientInterest_patientId_status_idx" ON "PatientInterest"("patientId", "status");

-- CreateIndex
CREATE INDEX "PatientInterest_serviceId_status_idx" ON "PatientInterest"("serviceId", "status");

-- CreateIndex
CREATE INDEX "PatientInterest_professionalId_status_idx" ON "PatientInterest"("professionalId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_clinicId_createdAt_idx" ON "AuditEvent"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_conversationId_createdAt_idx" ON "AuditEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_sentAt_idx" ON "ReminderDelivery"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_appointmentId_kind_key" ON "ReminderDelivery"("appointmentId", "kind");

-- CreateIndex
CREATE INDEX "ReactivationAttempt_clinicId_whatsappNumber_sentAt_idx" ON "ReactivationAttempt"("clinicId", "whatsappNumber", "sentAt");

-- CreateIndex
CREATE INDEX "CalendarConnection_provider_idx" ON "CalendarConnection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_clinicId_provider_key" ON "CalendarConnection"("clinicId", "provider");

-- CreateIndex
CREATE INDEX "ProcessedWebhookDelivery_clinicId_processedAt_idx" ON "ProcessedWebhookDelivery"("clinicId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookDelivery_provider_idempotencyKey_key" ON "ProcessedWebhookDelivery"("provider", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_deliveryKey_key" ON "OutboundDelivery"("deliveryKey");

-- CreateIndex
CREATE INDEX "OutboundDelivery_clinicId_automationType_status_idx" ON "OutboundDelivery"("clinicId", "automationType", "status");

-- CreateIndex
CREATE INDEX "OutboundDelivery_patientId_idx" ON "OutboundDelivery"("patientId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_conversationId_idx" ON "OutboundDelivery"("conversationId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_appointmentId_idx" ON "OutboundDelivery"("appointmentId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_toWhatsappNumber_idx" ON "OutboundDelivery"("toWhatsappNumber");

-- AddForeignKey
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ClinicLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicLead" ADD CONSTRAINT "ClinicLead_convertedClinicId_fkey" FOREIGN KEY ("convertedClinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicKnowledge" ADD CONSTRAINT "ClinicKnowledge_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProfessional" ADD CONSTRAINT "ServiceProfessional_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProfessional" ADD CONSTRAINT "ServiceProfessional_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProfessional" ADD CONSTRAINT "ServiceProfessional_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInterest" ADD CONSTRAINT "PatientInterest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInterest" ADD CONSTRAINT "PatientInterest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInterest" ADD CONSTRAINT "PatientInterest_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInterest" ADD CONSTRAINT "PatientInterest_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationAttempt" ADD CONSTRAINT "ReactivationAttempt_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedWebhookDelivery" ADD CONSTRAINT "ProcessedWebhookDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
