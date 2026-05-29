import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryCalendarCredentialRepository } from "../src/adapters/memory/calendar-auth-repository.js";
import {
  Aes256GcmTokenCipher,
  PrismaCalendarCredentialRepository
} from "../src/adapters/prisma/calendar-auth-repository.js";

const googleCalendarScope = "https://www.googleapis.com/auth/calendar";

describe("InMemoryCalendarCredentialRepository", () => {
  it("saves and reads a Google refresh token by clinicId", async () => {
    const repository = new InMemoryCalendarCredentialRepository();
    const expiryDate = new Date("2026-06-01T12:00:00.000Z");

    await repository.save({
      clinicId: "clinic_google_oauth_memory",
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken: "google_refresh_token",
      expiryDate
    });

    const credentials = await repository.get({
      clinicId: "clinic_google_oauth_memory",
      provider: "google"
    });

    expect(credentials).toMatchObject({
      clinicId: "clinic_google_oauth_memory",
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken: "google_refresh_token",
      expiryDate
    });
  });

  it("returns undefined when credentials are missing", async () => {
    const repository = new InMemoryCalendarCredentialRepository();

    await expect(
      repository.get({
        clinicId: "clinic_without_credentials",
        provider: "google"
      })
    ).resolves.toBeUndefined();
  });
});

describe("PrismaCalendarCredentialRepository", () => {
  const clinicId = "clinic_google_oauth_prisma";
  const prisma = new PrismaClient();
  const cipher = new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4));
  const repository = new PrismaCalendarCredentialRepository(prisma, cipher);

  beforeAll(async () => {
    await prisma.calendarConnection.deleteMany({ where: { clinicId } });
    await prisma.clinic.upsert({
      where: { id: clinicId },
      update: {},
      create: {
        id: clinicId,
        name: "Calendar Test Clinic",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });
  });

  afterAll(async () => {
    await prisma.calendarConnection.deleteMany({ where: { clinicId } });
    await prisma.clinic.deleteMany({ where: { id: clinicId } });
    await prisma.$disconnect();
  });

  it("stores encrypted tokens without exposing the raw refresh token string", async () => {
    const refreshToken = "raw_google_refresh_token_for_storage";

    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "google_access_token",
      refreshToken,
      expiryDate: new Date("2026-06-01T12:00:00.000Z")
    });

    const stored = await prisma.calendarConnection.findUnique({
      where: { clinicId_provider: { clinicId, provider: "google" } },
      select: { encryptedRefreshToken: true }
    });
    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(stored?.encryptedRefreshToken).toBeDefined();
    expect(stored?.encryptedRefreshToken).not.toContain(refreshToken);
    expect(credentials?.refreshToken).toBe(refreshToken);
  });
});
