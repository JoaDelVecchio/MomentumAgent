import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const cipher = new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4));
  let prisma: PrismaClient;
  let repository: PrismaCalendarCredentialRepository;
  let tempDirectory: string;

  beforeAll(async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "momentum-google-oauth-test-"));
    const databasePath = join(tempDirectory, "test.db");
    applySqliteMigrations(databasePath);
    prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
    repository = new PrismaCalendarCredentialRepository(prisma, cipher);

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
    await prisma.$disconnect();
    rmSync(tempDirectory, { recursive: true, force: true });
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

  it("preserves the existing refresh token when only access token details change", async () => {
    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "old_access_token",
      refreshToken: "stable_refresh_token",
      expiryDate: new Date("2026-06-01T12:00:00.000Z")
    });

    await repository.save({
      clinicId,
      provider: "google",
      providerAccountEmail: "calendar@example.com",
      scopes: [googleCalendarScope],
      accessToken: "new_access_token",
      expiryDate: new Date("2026-06-01T13:00:00.000Z")
    });

    const credentials = await repository.get({ clinicId, provider: "google" });

    expect(credentials?.accessToken).toBe("new_access_token");
    expect(credentials?.refreshToken).toBe("stable_refresh_token");
    expect(credentials?.expiryDate).toEqual(new Date("2026-06-01T13:00:00.000Z"));
  });

  it("returns undefined from Prisma storage when credentials are missing", async () => {
    await expect(
      repository.get({
        clinicId: "clinic_without_prisma_credentials",
        provider: "google"
      })
    ).resolves.toBeUndefined();
  });
});

describe("Aes256GcmTokenCipher", () => {
  it("rejects encrypted token payloads with non-canonical tag length", () => {
    const cipher = new Aes256GcmTokenCipher("01".repeat(32), () => Buffer.alloc(12, 4));
    const encrypted = cipher.encrypt("sensitive_refresh_token");
    const [version, iv, authTag, payload] = encrypted.split(":");
    const truncatedTag = Buffer.from(authTag ?? "", "base64").subarray(0, 4).toString("base64");

    expect(() => cipher.decrypt([version, iv, truncatedTag, payload].join(":"))).toThrow(
      "Invalid encrypted token payload"
    );
  });
});

function applySqliteMigrations(databasePath: string) {
  const migrationsPath = join(process.cwd(), "prisma", "migrations");
  const migrationSql = readdirSync(migrationsPath)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .map((entry) => readFileSync(join(migrationsPath, entry, "migration.sql"), "utf8"))
    .join("\n");

  execFileSync("sqlite3", [databasePath], { input: migrationSql });
}
