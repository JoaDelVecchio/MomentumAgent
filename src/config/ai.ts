export type AIConfig =
  | { provider: "rules" }
  | { provider: "openai"; apiKey: string; model: string; timeoutMs: number };

export function readAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const provider = env.AI_INTERPRETER_PROVIDER ?? "rules";
  if (provider === "rules") {
    return { provider: "rules" };
  }
  if (provider !== "openai") {
    throw new Error(`Unsupported AI_INTERPRETER_PROVIDER: ${provider}`);
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when AI_INTERPRETER_PROVIDER=openai");
  }

  return {
    provider: "openai",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL ?? "gpt-5-mini",
    timeoutMs: Number(env.OPENAI_TIMEOUT_MS ?? 1500)
  };
}
