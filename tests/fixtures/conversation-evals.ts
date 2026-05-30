import type { ConversationUnderstanding } from "../../src/application/conversations/interpreter.js";

export type ConversationEvalCase = {
  name: string;
  messageText: string;
  expected: Partial<ConversationUnderstanding>;
};

export const conversationEvalCases: ConversationEvalCase[] = [
  {
    name: "mixed price and booking",
    messageText: "Hola, cuanto sale botox y tenes algo a la tarde?",
    expected: { intent: "book", serviceName: "Botox", requestedTopics: ["price"], requiresHuman: false }
  },
  {
    name: "medical safety pregnancy",
    messageText: "Estoy embarazada, me recomendas hacerme botox?",
    expected: { intent: "medical_safety", requiresHuman: true }
  },
  {
    name: "reschedule",
    messageText: "Necesito cambiar mi turno para otro dia",
    expected: { intent: "reschedule", requiresHuman: false }
  },
  {
    name: "human handoff",
    messageText: "Me puede hablar una persona?",
    expected: { intent: "handoff", requiresHuman: true }
  }
];
