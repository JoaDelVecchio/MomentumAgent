import { describe, expect, it } from "vitest";
import { buildAgentTrace } from "../src/application/conversations/agent-trace.js";

describe("agent trace", () => {
  it("captures state, understanding, decision, and tool result in one stable object", () => {
    const trace = buildAgentTrace({
      state: {
        stage: "offering_slot",
        hasPendingBooking: true,
        botPaused: false
      },
      understanding: {
        provider: "openai",
        intent: "services_catalog",
        confidence: 0.95
      },
      decision: {
        action: "show_services",
        reason: "Patient asked for configured service catalog."
      },
      tool: {
        name: "clinic_profile",
        result: "read"
      }
    });

    expect(trace.state.stage).toBe("offering_slot");
    expect(trace.understanding.intent).toBe("services_catalog");
    expect(trace.decision.action).toBe("show_services");
    expect(trace.tool?.name).toBe("clinic_profile");
  });
});
