import { describe, expect, it } from "vitest";
import { decideAgentAction } from "../src/application/conversations/agent-router.js";
import type { ConversationState } from "../src/application/conversations/agent-state.js";
import type { ConversationUnderstanding } from "../src/application/conversations/interpreter.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

const profile = parseClinicProfile({
  clinicId: "clinic_1",
  name: "Clinica Demo",
  timezone: "America/Argentina/Buenos_Aires",
  services: [
    {
      id: "svc_botox",
      name: "Botox",
      durationMinutes: 30,
      priceText: "Desde $120.000",
      preparation: "Evitar alcohol 24 horas antes.",
      restrictions: [],
      professionalIds: ["pro_perez"]
    }
  ],
  professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
  appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
  requiredPatientFields: ["fullName"]
});

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
  offeredSlotStartsAt: "2026-06-07T14:00:00.000Z",
  missingPatientFields: ["fullName"],
  activeAppointmentCount: 0,
  lastPatientMessage: "si"
};

function understanding(input: Partial<ConversationUnderstanding>): ConversationUnderstanding {
  return {
    provider: "openai",
    intent: "unknown",
    confidence: 0.91,
    requestedTopics: [],
    requiresHuman: false,
    reason: "fake",
    ...input
  };
}

describe("decideAgentAction", () => {
  it("routes safety and human requests to handoff before any side effect", () => {
    expect(
      decideAgentAction({
        messageText: "estoy embarazada, me recomendas botox?",
        state: pendingState,
        understanding: understanding({ intent: "book", serviceName: "Botox" }),
        clinicProfile: profile
      })
    ).toEqual(expect.objectContaining({ action: "handoff", stage: "offering_slot" }));
  });

  it("keeps smalltalk and catalog questions non-transactional during a pending offer", () => {
    expect(
      decideAgentAction({
        messageText: "como te llamas",
        state: pendingState,
        understanding: understanding({ intent: "smalltalk" }),
        clinicProfile: profile
      })
    ).toEqual(
      expect.objectContaining({
        action: "reply_non_transactional",
        reply: {
          kind: "reply",
          text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
        }
      })
    );

    expect(
      decideAgentAction({
        messageText: "que servicios tenes",
        state: pendingState,
        understanding: understanding({ intent: "services_catalog" }),
        clinicProfile: profile
      })
    ).toEqual(
      expect.objectContaining({
        action: "reply_non_transactional",
        reply: { kind: "reply", text: "Por ahora puedo ayudarte con: Botox." }
      })
    );
  });

  it("routes pending-context questions, patient data, refinements, and confirmations explicitly", () => {
    expect(
      decideAgentAction({
        messageText: "cuanto sale",
        state: pendingState,
        understanding: understanding({ intent: "question", requestedTopics: ["price"] }),
        clinicProfile: profile
      }).action
    ).toBe("answer_pending_faq");

    expect(
      decideAgentAction({
        messageText: "Mi nombre es Ana Gomez",
        state: pendingState,
        understanding: understanding({ intent: "unknown", patientFullName: "Ana Gomez" }),
        clinicProfile: profile
      }).action
    ).toBe("complete_pending_patient_data");

    expect(
      decideAgentAction({
        messageText: "que turnos tenes el 7 de junio",
        state: pendingState,
        understanding: understanding({ intent: "slot_refinement", normalizedTimePreference: { daypart: "afternoon" } }),
        clinicProfile: profile
      }).action
    ).toBe("refine_pending_slot");

    expect(
      decideAgentAction({
        messageText: "si",
        state: pendingState,
        understanding: understanding({ intent: "confirm" }),
        clinicProfile: profile
      }).action
    ).toBe("confirm_pending_booking");
  });

  it("protects side effects on low confidence and routes clear operational intents", () => {
    expect(
      decideAgentAction({
        messageText: "cancelar",
        state: idleState,
        understanding: understanding({ intent: "cancel", confidence: 0.1 }),
        clinicProfile: profile
      }).action
    ).toBe("clarify_low_confidence");

    expect(
      decideAgentAction({
        messageText: "quiero reservar botox",
        state: idleState,
        understanding: understanding({ intent: "book", serviceName: "Botox" }),
        clinicProfile: profile
      }).action
    ).toBe("search_slots");

    expect(
      decideAgentAction({
        messageText: "cancelar mi turno",
        state: idleState,
        understanding: understanding({ intent: "cancel" }),
        clinicProfile: profile
      }).action
    ).toBe("cancel_appointment");

    expect(
      decideAgentAction({
        messageText: "cambiar mi turno",
        state: idleState,
        understanding: understanding({ intent: "reschedule" }),
        clinicProfile: profile
      }).action
    ).toBe("reschedule_appointment");
  });

  it("routes FAQ and unknown messages to explicit answer/fallback actions", () => {
    expect(
      decideAgentAction({
        messageText: "cuanto sale botox",
        state: idleState,
        understanding: understanding({ intent: "question", serviceName: "Botox", requestedTopics: ["price"] }),
        clinicProfile: profile
      }).action
    ).toBe("answer_faq");

    expect(
      decideAgentAction({
        messageText: "ok dale",
        state: idleState,
        understanding: understanding({ intent: "unknown" }),
        clinicProfile: profile
      }).action
    ).toBe("reply_contextual_fallback");
  });
});
