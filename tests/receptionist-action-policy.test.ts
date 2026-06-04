import { describe, expect, it } from "vitest";
import { decideReceptionistAction } from "../src/application/conversations/receptionist-action-policy.js";
import type { ConversationState } from "../src/application/conversations/agent-state.js";
import type { ReceptionistTurn } from "../src/application/conversations/receptionist-agent.js";

const idleState: ConversationState = {
  stage: "idle",
  hasPendingBooking: false,
  pendingBookingKind: "none",
  missingPatientFields: ["fullName"],
  activeAppointmentCount: 0,
  lastPatientMessage: "hola"
};

const pendingState: ConversationState = {
  stage: "offering_slot",
  hasPendingBooking: true,
  pendingBookingKind: "new_booking",
  selectedServiceId: "svc_botox",
  selectedProfessionalId: "pro_perez",
  offeredSlotStartsAt: "2026-06-04T12:00:00.000Z",
  missingPatientFields: ["fullName"],
  activeAppointmentCount: 0,
  lastPatientMessage: "agendalo"
};

function turn(input: Partial<ReceptionistTurn>): ReceptionistTurn {
  return {
    replyDraft: "Te ayudo desde recepcion.",
    proposedAction: "reply_only",
    confidence: 0.92,
    serviceName: null,
    professionalPreference: null,
    timePreference: null,
    requestedTopics: [],
    patientFullName: null,
    needsHuman: false,
    safetyReason: null,
    reason: "fake receptionist turn",
    grounding: [],
    missingFacts: [],
    ...input
  };
}

describe("decideReceptionistAction", () => {
  it("allows explicit pending booking confirmation from agendalo", () => {
    expect(
      decideReceptionistAction({
        messageText: "agendalo",
        state: pendingState,
        turn: turn({ proposedAction: "confirm_pending_booking" })
      })
    ).toEqual(
      expect.objectContaining({
        proposedAction: "confirm_pending_booking",
        action: "confirm_pending_booking"
      })
    );
  });

  it("does not confirm a pending booking from abusive or irrelevant text", () => {
    expect(
      decideReceptionistAction({
        messageText: "jero es un trolo",
        state: pendingState,
        turn: turn({ proposedAction: "confirm_pending_booking", confidence: 0.96 })
      })
    ).toEqual(
      expect.objectContaining({
        proposedAction: "confirm_pending_booking",
        action: "reply_only"
      })
    );
  });

  it("does not allow any calendar side effect from abusive text", () => {
    expect(
      decideReceptionistAction({
        messageText: "quiero reservar botox pelotudo",
        state: idleState,
        turn: turn({ proposedAction: "search_slots", serviceName: "Botox", confidence: 0.96 })
      })
    ).toEqual(
      expect.objectContaining({
        proposedAction: "search_slots",
        action: "reply_only"
      })
    );
  });

  it("does not confirm without a pending booking", () => {
    expect(
      decideReceptionistAction({
        messageText: "confirmalo",
        state: idleState,
        turn: turn({ proposedAction: "confirm_pending_booking" })
      })
    ).toEqual(
      expect.objectContaining({
        proposedAction: "confirm_pending_booking",
        action: "reply_only"
      })
    );
  });

  it("downgrades low-confidence side effects", () => {
    expect(
      decideReceptionistAction({
        messageText: "botox",
        state: idleState,
        turn: turn({ proposedAction: "search_slots", serviceName: "Botox", confidence: 0.2 })
      })
    ).toEqual(
      expect.objectContaining({
        proposedAction: "search_slots",
        action: "reply_only"
      })
    );
  });

  it("allows high-confidence slot search when a service is present", () => {
    expect(
      decideReceptionistAction({
        messageText: "quiero reservar botox",
        state: idleState,
        turn: turn({ proposedAction: "search_slots", serviceName: "Botox", confidence: 0.91 })
      }).action
    ).toBe("search_slots");
  });

  it("routes medical safety to handoff", () => {
    expect(
      decideReceptionistAction({
        messageText: "estoy embarazada, puedo hacerme botox?",
        state: idleState,
        turn: turn({
          proposedAction: "handoff",
          needsHuman: true,
          safetyReason: "personalized_medical_advice"
        })
      }).action
    ).toBe("handoff");
  });

  it("allows complete high-confidence patient data while a booking is pending", () => {
    expect(
      decideReceptionistAction({
        messageText: "Soy Ana Gomez",
        state: pendingState,
        turn: turn({
          proposedAction: "collect_patient_data",
          patientFullName: "Ana Gomez",
          confidence: 0.94
        })
      }).action
    ).toBe("collect_patient_data");
  });

  it("does not collect incomplete patient names", () => {
    expect(
      decideReceptionistAction({
        messageText: "Ana",
        state: pendingState,
        turn: turn({
          proposedAction: "collect_patient_data",
          patientFullName: "Ana",
          confidence: 0.94
        })
      }).action
    ).toBe("reply_only");
  });
});
