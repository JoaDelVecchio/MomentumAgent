export type AIConfig =
  | { provider: "rules" }
  | { provider: "openai"; apiKey: string; model: string; timeoutMs: number };

export function readAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const provider = env.AI_INTERPRETER_PROVIDER?.trim() || "rules";
  if (provider === "rules") {
    return { provider: "rules" };
  }
  if (provider !== "openai") {
    throw new Error(`Unsupported AI_INTERPRETER_PROVIDER: ${provider}`);
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_INTERPRETER_PROVIDER=openai");
  }
  const model = env.OPENAI_MODEL === undefined ? "gpt-5-mini" : env.OPENAI_MODEL.trim();
  if (!model) {
    throw new Error("OPENAI_MODEL must not be empty when provided");
  }
  const timeoutMs = Number(env.OPENAI_TIMEOUT_MS ?? 1500);
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OPENAI_TIMEOUT_MS must be a positive finite integer");
  }

  return {
    provider: "openai",
    apiKey,
    model,
    timeoutMs
  };
}
