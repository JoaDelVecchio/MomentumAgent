import { optionalEnv } from "./env.js";

export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type OpenAIInterpreterFallbackMode = "clarify" | "rules";
export type AIResponseComposerMode = "openai" | "off";

export type AIConfig =
  | { provider: "rules" }
  | {
      provider: "openai";
      apiKey: string;
      model: string;
      timeoutMs: number;
      reasoningEffort: OpenAIReasoningEffort;
      interpreterFallback: OpenAIInterpreterFallbackMode;
      responseComposer: AIResponseComposerMode;
    };

export function readAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const provider = optionalEnv(env.AI_INTERPRETER_PROVIDER) ?? inferDefaultProvider(env);
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
  const reasoningEffort = parseReasoningEffort(optionalEnv(env.OPENAI_REASONING_EFFORT) ?? "medium");
  const interpreterFallback = parseInterpreterFallback(optionalEnv(env.AI_INTERPRETER_FALLBACK) ?? "clarify");
  const responseComposer = parseResponseComposer(optionalEnv(env.AI_RESPONSE_COMPOSER) ?? "openai");

  return {
    provider: "openai",
    apiKey,
    model: model ?? "gpt-5.5",
    timeoutMs,
    reasoningEffort,
    interpreterFallback,
    responseComposer
  };
}

function inferDefaultProvider(env: NodeJS.ProcessEnv) {
  return optionalEnv(env.OPENAI_API_KEY) ? "openai" : "rules";
}

function isBlankPlaceholder(value: string) {
  const trimmed = value.trim();
  return trimmed === '""' || trimmed === "''";
}

function parseReasoningEffort(value: string): OpenAIReasoningEffort {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  throw new Error(`Unsupported OPENAI_REASONING_EFFORT: ${value}`);
}

function parseInterpreterFallback(value: string): OpenAIInterpreterFallbackMode {
  if (value === "clarify" || value === "rules") {
    return value;
  }
  throw new Error(`Unsupported AI_INTERPRETER_FALLBACK: ${value}`);
}

function parseResponseComposer(value: string): AIResponseComposerMode {
  if (value === "openai" || value === "off") {
    return value;
  }
  throw new Error(`Unsupported AI_RESPONSE_COMPOSER: ${value}`);
}
