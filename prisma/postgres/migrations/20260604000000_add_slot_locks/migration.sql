-- CreateTable
CREATE TABLE "SlotLock" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlotLock_clinicId_status_expiresAt_idx" ON "SlotLock"("clinicId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "SlotLock_clinicId_calendarId_startsAt_endsAt_idx" ON "SlotLock"("clinicId", "calendarId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "SlotLock_conversationId_idx" ON "SlotLock"("conversationId");

-- AddForeignKey
ALTER TABLE "SlotLock" ADD CONSTRAINT "SlotLock_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
