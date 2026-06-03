import type { Appointment, ClinicProfile, Patient, PatientField } from "../../domain/types.js";
import type { Conversation } from "../../ports/repositories.js";

export type ConversationStage =
  | "paused"
  | "idle"
  | "offering_slot"
  | "rescheduling"
  | "collecting_patient_data"
  | "booked"
  | "needs_handoff";

export type PendingBookingKind = "none" | "new_booking" | "reschedule";

export type ConversationState = {
  stage: ConversationStage;
  hasPendingBooking: boolean;
  pendingBookingKind: PendingBookingKind;
  selectedServiceId?: string;
  selectedProfessionalId?: string;
  offeredSlotStartsAt?: string;
  missingPatientFields: PatientField[];
  activeAppointmentCount: number;
  lastPatientMessage: string;
};

export function buildConversationState(input: {
  conversation: Conversation;
  clinicProfile?: ClinicProfile;
  patient?: Patient;
  activeAppointments: Appointment[];
  messageText: string;
  lastAgentAction?: "request_patient_data";
}): ConversationState {
  const pendingBooking = input.conversation.pendingBooking;
  const missingPatientFields = missingRequiredPatientFields(input.clinicProfile, input.patient);
  const pendingBookingKind: PendingBookingKind = pendingBooking
    ? pendingBooking.appointmentId
      ? "reschedule"
      : "new_booking"
    : "none";

  return {
    stage: deriveStage({
      botPaused: input.conversation.botPaused,
      hasPendingBooking: Boolean(pendingBooking),
      pendingBookingKind,
      activeAppointmentCount: input.activeAppointments.length,
      missingPatientFields,
      lastAgentAction: input.lastAgentAction
    }),
    hasPendingBooking: Boolean(pendingBooking),
    pendingBookingKind,
    ...(pendingBooking?.serviceId ? { selectedServiceId: pendingBooking.serviceId } : {}),
    ...(pendingBooking?.professionalId ? { selectedProfessionalId: pendingBooking.professionalId } : {}),
    ...(pendingBooking?.startsAt ? { offeredSlotStartsAt: pendingBooking.startsAt.toISOString() } : {}),
    missingPatientFields,
    activeAppointmentCount: input.activeAppointments.length,
    lastPatientMessage: input.messageText
  };
}

function deriveStage(input: {
  botPaused: boolean;
  hasPendingBooking: boolean;
  pendingBookingKind: PendingBookingKind;
  activeAppointmentCount: number;
  missingPatientFields: PatientField[];
  lastAgentAction?: "request_patient_data";
}): ConversationStage {
  if (input.botPaused) {
    return "paused";
  }
  if (input.lastAgentAction === "request_patient_data" && input.hasPendingBooking && input.missingPatientFields.length > 0) {
    return "collecting_patient_data";
  }
  if (input.pendingBookingKind === "reschedule") {
    return "rescheduling";
  }
  if (input.hasPendingBooking) {
    return "offering_slot";
  }
  if (input.activeAppointmentCount > 0) {
    return "booked";
  }
  return "idle";
}

function missingRequiredPatientFields(profile: ClinicProfile | undefined, patient: Patient | undefined) {
  if (!profile) {
    return [];
  }

  return profile.requiredPatientFields.filter((field) => field === "fullName" && !patient?.fullName);
}
