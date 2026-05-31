import type { IncomingMessage, ServerResponse } from "node:http";

const ENV_NAMES = [
  "DATABASE_URL",
  "STORAGE_DATABASE_URL",
  "STORAGE_POSTGRES_PRISMA_URL",
  "STORAGE_POSTGRES_URL",
  "STORAGE_POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "CALENDAR_PROVIDER",
  "MOMENTUM_RUNTIME_ENV",
  "VERCEL_ENV",
  "NODE_ENV"
] as const;

export default function handler(_request: IncomingMessage, response: ServerResponse) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      env: Object.fromEntries(ENV_NAMES.map((name) => [name, classify(process.env[name])]))
    })
  );
}

function classify(value: string | undefined) {
  const trimmed = value?.trim();
  return {
    present: value !== undefined,
    length: value?.length ?? 0,
    kind: classifyKind(trimmed)
  };
}

function classifyKind(trimmed: string | undefined) {
  if (!trimmed || trimmed === '""' || trimmed === "''") return "blank";
  if (trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://")) return "postgres";
  if (trimmed.startsWith("file:")) return "sqlite";
  if (trimmed.startsWith("$") || trimmed.startsWith("@")) return "reference";
  return "other";
}
