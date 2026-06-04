import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  ConversationResponseComposer,
  ConversationResponseComposerInput
} from "../../application/conversations/response-composer.js";

const responseCompositionSchema = z.object({
  text: z.string().min(1).max(1000)
});

type OpenAIResponsesClient = {
  responses: {
    parse: (body: any, options?: { timeout?: number }) => Promise<{ output_parsed: unknown }>;
  };
};

type OpenAIConversationResponseComposerOptions = {
  client: OpenAIResponsesClient;
  model: string;
  timeoutMs: number;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
};

export class OpenAIConversationResponseComposer implements ConversationResponseComposer {
  constructor(private readonly options: OpenAIConversationResponseComposerOptions) {}

  async compose(input: ConversationResponseComposerInput): Promise<string | undefined> {
    try {
      const response = await this.options.client.responses.parse(
        {
          model: this.options.model,
          instructions: buildInstructions(),
          input: JSON.stringify(buildComposerPayload(input)),
          tools: [],
          reasoning: { effort: this.options.reasoningEffort },
          max_output_tokens: 500,
          text: {
            verbosity: "low",
            format: zodTextFormat(responseCompositionSchema, "momentum_response_composition")
          }
        },
        { timeout: this.options.timeoutMs }
      );
      const parsed = responseCompositionSchema.parse(response.output_parsed);
      return parsed.text.trim();
    } catch {
      return undefined;
    }
  }
}

function buildInstructions() {
  return [
    "You are Momentum, a WhatsApp receptionist assistant for aesthetic clinics in Argentina.",
    "Rewrite the draft reply so it sounds natural, helpful, and context-aware in Argentine Spanish.",
    "Preserve the exact operational meaning of the draft. Do not add, remove, or change appointments, dates, times, prices, service names, professional names, preparation instructions, restrictions, or handoff decisions.",
    "Do not invent availability. Calendar availability is already decided by application code.",
    "Do not diagnose, recommend treatment for a personal medical case, or decide medical eligibility.",
    "If the draft says a human receptionist will continue, keep that meaning.",
    "Do not add emojis unless the patient used emojis first.",
    "Keep replies concise for WhatsApp: one short paragraph, or two short sentences when clearer.",
    "Return only the requested structured JSON."
  ].join("\n");
}

function buildComposerPayload(input: ConversationResponseComposerInput) {
  return {
    patientMessage: input.patientMessage,
    recentMessages: input.recentMessages.map((message) => ({
      role: message.role,
      text: message.text,
      at: message.at.toISOString()
    })),
    draftText: input.draftText,
    action: input.action,
    conversationState: input.conversationState,
    understanding: {
      provider: input.understanding.provider,
      intent: input.understanding.intent,
      confidence: input.understanding.confidence,
      serviceName: input.understanding.serviceName,
      professionalPreference: input.understanding.professionalPreference,
      timePreference: input.understanding.timePreference,
      normalizedTimePreference: input.understanding.normalizedTimePreference,
      requestedTopics: input.understanding.requestedTopics,
      requiresHuman: input.understanding.requiresHuman,
      safetyReason: input.understanding.safetyReason
    },
    clinicProfile: input.clinicProfile
      ? {
          name: input.clinicProfile.name,
          timezone: input.clinicProfile.timezone,
          services: input.clinicProfile.services.map((service) => ({
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceText: service.priceText,
            preparation: service.preparation,
            restrictions: service.restrictions
          })),
          professionals: input.clinicProfile.professionals.map((professional) => ({
            name: professional.name
          }))
        }
      : undefined
  };
}
