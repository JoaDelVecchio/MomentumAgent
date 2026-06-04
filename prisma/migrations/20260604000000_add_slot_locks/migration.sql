CREATE TABLE "SlotLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SlotLock_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SlotLock_clinicId_status_expiresAt_idx" ON "SlotLock"("clinicId", "status", "expiresAt");
CREATE INDEX "SlotLock_clinicId_calendarId_startsAt_endsAt_idx" ON "SlotLock"("clinicId", "calendarId", "startsAt", "endsAt");
CREATE INDEX "SlotLock_conversationId_idx" ON "SlotLock"("conversationId");
