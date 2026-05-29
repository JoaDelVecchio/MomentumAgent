-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountEmail" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiryDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CalendarConnection_provider_idx" ON "CalendarConnection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_clinicId_provider_key" ON "CalendarConnection"("clinicId", "provider");
