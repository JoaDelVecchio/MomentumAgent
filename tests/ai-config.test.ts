import { describe, expect, it } from "vitest";
import { readAIConfig } from "../src/config/ai.js";

describe("readAIConfig", () => {
  it("defaults to the rule-based interpreter", () => {
    expect(readAIConfig({})).toEqual({ provider: "rules" });
  });

  it("uses OpenAI by default when an API key is configured", () => {
    expect(readAIConfig({ OPENAI_API_KEY: " sk-test " })).toEqual({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-5-mini",
      timeoutMs: 1500
    });
  });

  it("keeps the rule-based interpreter when explicitly selected even with an API key", () => {
    expect(readAIConfig({ AI_INTERPRETER_PROVIDER: "rules", OPENAI_API_KEY: "sk-test" })).toEqual({
      provider: "rules"
    });
  });

  it("reads OpenAI interpreter settings", () => {
    expect(
      readAIConfig({
        AI_INTERPRETER_PROVIDER: " openai ",
        OPENAI_API_KEY: " sk-test ",
        OPENAI_MODEL: " gpt-5-mini ",
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

  it("rejects unsupported providers", () => {
    expect(() => readAIConfig({ AI_INTERPRETER_PROVIDER: "anthropic" })).toThrow(
      "Unsupported AI_INTERPRETER_PROVIDER: anthropic"
    );
  });

  it("rejects whitespace-only OpenAI API keys", () => {
    expect(() =>
      readAIConfig({
        AI_INTERPRETER_PROVIDER: "openai",
        OPENAI_API_KEY: "   "
      })
    ).toThrow("OPENAI_API_KEY is required when AI_INTERPRETER_PROVIDER=openai");
  });

  it("rejects whitespace-only OpenAI models", () => {
    expect(() =>
      readAIConfig({
        AI_INTERPRETER_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "   "
      })
    ).toThrow("OPENAI_MODEL must not be empty when provided");
  });

  it("rejects invalid OpenAI timeouts", () => {
    for (const timeoutMs of ["abc", "Infinity", "1.5", "0", "-1"]) {
      expect(() =>
        readAIConfig({
          AI_INTERPRETER_PROVIDER: "openai",
          OPENAI_API_KEY: "sk-test",
          OPENAI_TIMEOUT_MS: timeoutMs
        })
      ).toThrow("OPENAI_TIMEOUT_MS must be a positive finite integer");
    }
  });
});
