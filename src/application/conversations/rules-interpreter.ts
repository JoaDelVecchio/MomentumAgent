import type { ConversationInterpreter, ConversationInterpreterInput, ConversationUnderstanding } from "./interpreter.js";
import { interpretIntent } from "./intent.js";

export class RulesConversationInterpreter implements ConversationInterpreter {
  async interpret(input: ConversationInterpreterInput): Promise<ConversationUnderstanding> {
    const intent = interpretIntent(input.messageText);

    if (intent.type === "handoff") {
      return {
        provider: "rules",
        intent: "handoff",
        confidence: 0.9,
        requestedTopics: [],
        requiresHuman: true,
        safetyReason: intent.reason,
        reason: "Rule-based human handoff keyword matched."
      };
    }

    if (intent.type === "book") {
      return {
        provider: "rules",
        intent: "book",
        confidence: intent.serviceName ? 0.8 : 0.65,
        serviceName: intent.serviceName || undefined,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Rule-based booking keyword matched."
      };
    }

    return {
      provider: "rules",
      intent: intent.type,
      confidence: intent.type === "question" ? 0.45 : 0.75,
      requestedTopics: [],
      requiresHuman: false,
      reason: `Rule-based ${intent.type} keyword matched.`
    };
  }
}
