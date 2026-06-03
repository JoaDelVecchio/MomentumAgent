import type {
  ConversationInterpreter,
  ConversationInterpreterInput,
  ConversationUnderstanding
} from "./interpreter.js";

export class FallbackConversationInterpreter implements ConversationInterpreter {
  constructor(
    private readonly primary: ConversationInterpreter,
    private readonly fallback: ConversationInterpreter
  ) {}

  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    let primaryFailureReason: string | undefined;

    try {
      const result = await this.primary.interpret(input);
      if (result.provider !== "fallback") {
        return result;
      }
      primaryFailureReason = result.reason;
    } catch (error) {
      primaryFailureReason = errorMessage(error);
      // Use deterministic interpretation when the primary provider is unavailable.
    }

    const fallbackResult = await this.fallback.interpret(input);
    if (!primaryFailureReason) {
      return fallbackResult;
    }

    return {
      ...fallbackResult,
      reason: `${fallbackResult.reason} Primary provider fallback: ${primaryFailureReason}`
    };
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}
