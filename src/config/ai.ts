import { optionalEnv } from "./env.js";

export type AIConfig =
  | { provider: "rules" }
  | { provider: "openai"; apiKey: string; model: string; timeoutMs: number };

export function readAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const provider = optionalEnv(env.AI_INTERPRETER_PROVIDER) ?? "rules";
  if (provider === "rules") {
    return { provider: "rules" };
  }
  if (provider !== "openai") {
    throw new Error(`Unsupported AI_INTERPRETER_PROVIDER: ${provider}`);
  }
  const apiKey = optionalEnv(env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_INTERPRETER_PROVIDER=openai");
  }
  const model = optionalEnv(env.OPENAI_MODEL);
  if (env.OPENAI_MODEL !== undefined && !model && !isBlankPlaceholder(env.OPENAI_MODEL)) {
    throw new Error("OPENAI_MODEL must not be empty when provided");
  }
  const timeoutMs = Number(optionalEnv(env.OPENAI_TIMEOUT_MS) ?? 1500);
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OPENAI_TIMEOUT_MS must be a positive finite integer");
  }

  return {
    provider: "openai",
    apiKey,
    model: model ?? "gpt-5-mini",
    timeoutMs
  };
}

function isBlankPlaceholder(value: string) {
  const trimmed = value.trim();
  return trimmed === '""' || trimmed === "''";
}
