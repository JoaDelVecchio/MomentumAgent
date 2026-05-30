PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
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

INSERT INTO "new_Appointment" (
    "id",
    "clinicId",
    "patientId",
    "serviceId",
    "professionalId",
    "calendarEventId",
    "calendarId",
    "startsAt",
    "endsAt",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    "Appointment"."id",
    "Appointment"."clinicId",
    "Appointment"."patientId",
    "Appointment"."serviceId",
    "Appointment"."professionalId",
    "Appointment"."calendarEventId",
    "Professional"."calendarId",
    "Appointment"."startsAt",
    "Appointment"."endsAt",
    "Appointment"."status",
    "Appointment"."createdAt",
    "Appointment"."updatedAt"
FROM "Appointment"
LEFT JOIN "Professional"
    ON "Professional"."clinicId" = "Appointment"."clinicId"
    AND "Professional"."id" = "Appointment"."professionalId";

DROP TABLE "Appointment";

ALTER TABLE "new_Appointment" RENAME TO "Appointment";

CREATE UNIQUE INDEX "Appointment_calendarEventId_key" ON "Appointment"("calendarEventId");
CREATE INDEX "Appointment_clinicId_startsAt_idx" ON "Appointment"("clinicId", "startsAt");
CREATE INDEX "Appointment_patientId_status_idx" ON "Appointment"("patientId", "status");
CREATE INDEX "Appointment_serviceId_idx" ON "Appointment"("serviceId");
CREATE INDEX "Appointment_professionalId_startsAt_idx" ON "Appointment"("professionalId", "startsAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
