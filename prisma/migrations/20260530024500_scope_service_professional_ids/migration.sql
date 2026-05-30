PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Service" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceText" TEXT NOT NULL,
    "preparation" TEXT NOT NULL,
    "restrictionsJson" TEXT NOT NULL,
    PRIMARY KEY ("clinicId", "id"),
    CONSTRAINT "Service_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Service" ("id", "clinicId", "name", "durationMinutes", "priceText", "preparation", "restrictionsJson")
SELECT "id", "clinicId", "name", "durationMinutes", "priceText", "preparation", "restrictionsJson" FROM "Service";

DROP TABLE "Service";

ALTER TABLE "new_Service" RENAME TO "Service";

CREATE INDEX "Service_clinicId_idx" ON "Service"("clinicId");

CREATE TABLE "new_Professional" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    PRIMARY KEY ("clinicId", "id"),
    CONSTRAINT "Professional_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Professional" ("id", "clinicId", "name", "calendarId")
SELECT "id", "clinicId", "name", "calendarId" FROM "Professional";

DROP TABLE "Professional";

ALTER TABLE "new_Professional" RENAME TO "Professional";

CREATE INDEX "Professional_clinicId_idx" ON "Professional"("clinicId");
CREATE UNIQUE INDEX "Professional_clinicId_calendarId_key" ON "Professional"("clinicId", "calendarId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
