import type { ClinicProfile } from "../../domain/types.js";
import type { ConversationMessage } from "../../ports/repositories.js";
import type { AgentActionType } from "./agent-router.js";
import type { ConversationState } from "./agent-state.js";
import type { ConversationUnderstanding } from "./interpreter.js";

export type ConversationResponseComposerInput = {
  clinicProfile?: ClinicProfile;
  conversationState: ConversationState;
  understanding: ConversationUnderstanding;
  action: AgentActionType;
  patientMessage: string;
  recentMessages: ConversationMessage[];
  draftText: string;
};

export interface ConversationResponseComposer {
  compose(input: ConversationResponseComposerInput): Promise<string | undefined>;
}
