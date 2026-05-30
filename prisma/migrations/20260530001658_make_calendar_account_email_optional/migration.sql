-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountEmail" TEXT,
    "scopesJson" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiryDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CalendarConnection" ("clinicId", "createdAt", "encryptedAccessToken", "encryptedRefreshToken", "expiryDate", "id", "provider", "providerAccountEmail", "scopesJson", "updatedAt") SELECT "clinicId", "createdAt", "encryptedAccessToken", "encryptedRefreshToken", "expiryDate", "id", "provider", "providerAccountEmail", "scopesJson", "updatedAt" FROM "CalendarConnection";
DROP TABLE "CalendarConnection";
ALTER TABLE "new_CalendarConnection" RENAME TO "CalendarConnection";
CREATE INDEX "CalendarConnection_provider_idx" ON "CalendarConnection"("provider");
CREATE UNIQUE INDEX "CalendarConnection_clinicId_provider_key" ON "CalendarConnection"("clinicId", "provider");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
