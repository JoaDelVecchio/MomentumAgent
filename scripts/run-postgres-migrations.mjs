import { spawnSync } from "node:child_process";

const databaseUrl = [
  process.env.STORAGE_POSTGRES_PRISMA_URL,
  process.env.STORAGE_DATABASE_URL,
  process.env.STORAGE_POSTGRES_URL,
  process.env.DATABASE_URL
].find((value) => isPostgresUrl(value));

if (!databaseUrl) {
  if (process.env.VERCEL) {
    console.error("Postgres migrations require a Postgres DATABASE_URL or Vercel Storage Postgres URL.");
    process.exit(1);
  }
  console.log("Skipping Postgres migrations because no Postgres URL is configured locally.");
  process.exit(0);
}

const prismaBin = process.platform === "win32" ? "node_modules/.bin/prisma.cmd" : "node_modules/.bin/prisma";
const result = spawnSync(prismaBin, ["migrate", "deploy", "--schema", "prisma/postgres/schema.prisma"], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function isPostgresUrl(value) {
  return value?.startsWith("postgresql://") || value?.startsWith("postgres://");
}
