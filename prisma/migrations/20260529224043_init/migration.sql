-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "minimumNoticeMinutes" INTEGER NOT NULL,
    "cancellationNoticeMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL,
    "requiredPatientFieldsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceText" TEXT NOT NULL,
    "preparation" TEXT NOT NULL,
    "restrictionsJson" TEXT NOT NULL,
    CONSTRAINT "Service_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Professional" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    CONSTRAINT "Professional_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceProfessional" (
    "clinicId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,

    PRIMARY KEY ("clinicId", "serviceId", "professionalId"),
    CONSTRAINT "ServiceProfessional_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceProfessional_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceProfessional_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whatsappNumber" TEXT NOT NULL,
    "fullName" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "pendingBookingJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientInterest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT,
    "preferredFrom" DATETIME NOT NULL,
    "preferredTo" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientInterest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PatientInterest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PatientInterest_clinicId_serviceId_fkey" FOREIGN KEY ("clinicId", "serviceId") REFERENCES "Service" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PatientInterest_clinicId_professionalId_fkey" FOREIGN KEY ("clinicId", "professionalId") REFERENCES "Professional" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_clinicId_conversationId_fkey" FOREIGN KEY ("clinicId", "conversationId") REFERENCES "Conversation" ("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReactivationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "sentAt" DATETIME NOT NULL,
    "outcome" TEXT,
    CONSTRAINT "ReactivationAttempt_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Service_clinicId_idx" ON "Service"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_clinicId_id_key" ON "Service"("clinicId", "id");

-- CreateIndex
CREATE INDEX "Professional_clinicId_idx" ON "Professional"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Professional_clinicId_id_key" ON "Professional"("clinicId", "id");

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
CREATE UNIQUE INDEX "Conversation_clinicId_id_key" ON "Conversation"("clinicId", "id");

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
