import { describe, expect, it } from "vitest";
import { readAIConfig } from "../src/config/ai.js";

describe("readAIConfig", () => {
  it("defaults to the rule-based interpreter", () => {
    expect(readAIConfig({})).toEqual({ provider: "rules" });
  });

  it("reads OpenAI interpreter settings", () => {
    expect(
      readAIConfig({
        AI_INTERPRETER_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "gpt-5-mini",
        OPENAI_TIMEOUT_MS: "1200"
      })
    ).toEqual({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-5-mini",
      timeoutMs: 1200
    });
  });

  it("requires an OpenAI API key when OpenAI mode is selected", () => {
    expect(() => readAIConfig({ AI_INTERPRETER_PROVIDER: "openai" })).toThrow(
      "OPENAI_API_KEY is required when AI_INTERPRETER_PROVIDER=openai"
    );
  });
});
