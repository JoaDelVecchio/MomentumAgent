export type AgentStage =
  | "idle"
  | "selecting_service"
  | "offering_slot"
  | "collecting_patient_data"
  | "booking_ready"
  | "booked"
  | "rescheduling"
  | "cancelling"
  | "handoff"
  | "paused";

export type AgentAction =
  | "reply"
  | "answer_faq"
  | "show_services"
  | "search_slots"
  | "offer_slot"
  | "refine_slot"
  | "collect_patient_data"
  | "start_whatsapp_flow"
  | "book_appointment"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "send_reminder"
  | "handoff"
  | "pause"
  | "no_op_wait";

export type AgentTrace = {
  state: {
    stage: AgentStage;
    hasPendingBooking: boolean;
    botPaused: boolean;
  };
  understanding: {
    provider: string;
    intent: string;
    confidence: number;
  };
  decision: {
    action: AgentAction;
    reason: string;
  };
  tool?: {
    name: string;
    result: "read" | "simulated" | "executed" | "skipped" | "failed";
  };
};

export function buildAgentTrace(trace: AgentTrace): AgentTrace {
  return trace;
}
