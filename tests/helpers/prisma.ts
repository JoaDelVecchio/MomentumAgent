import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PrismaTestContext = {
  prisma: PrismaClient;
  databasePath: string;
  cleanup(): Promise<void>;
};

export function createPrismaTestContext(prefix: string): PrismaTestContext {
  const tempDirectory = mkdtempSync(join(tmpdir(), prefix));
  const databasePath = join(tempDirectory, "test.db");
  applySqliteMigrations(databasePath);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });

  return {
    prisma,
    databasePath,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  };
}

export function applySqliteMigrations(databasePath: string) {
  const migrationsPath = join(process.cwd(), "prisma", "migrations");
  const migrationSql = readdirSync(migrationsPath)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .map((entry) => readFileSync(join(migrationsPath, entry, "migration.sql"), "utf8"))
    .join("\n");

  execFileSync("sqlite3", [databasePath], { input: migrationSql });
}
