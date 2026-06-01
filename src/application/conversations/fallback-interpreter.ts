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
    try {
      const result = await this.primary.interpret(input);
      if (result.provider !== "fallback") {
        return result;
      }
    } catch {
      // Use deterministic interpretation when the primary provider is unavailable.
    }

    return this.fallback.interpret(input);
  }
}
