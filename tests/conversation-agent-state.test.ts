import { describe, expect, it } from "vitest";
import { buildConversationState } from "../src/application/conversations/agent-state.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { Appointment } from "../src/domain/types.js";
import type { Conversation } from "../src/ports/repositories.js";

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

const baseConversation: Conversation = {
  id: "conv_1",
  clinicId: "clinic_1",
  patientId: "pat_1",
  botPaused: false,
  createdAt: new Date("2026-06-03T12:00:00.000Z"),
  updatedAt: new Date("2026-06-03T12:00:00.000Z")
};

const appointment: Appointment = {
  id: "appt_1",
  clinicId: "clinic_1",
  patientId: "pat_1",
  serviceId: "svc_botox",
  professionalId: "pro_perez",
  calendarEventId: "evt_1",
  calendarId: "cal_perez",
  startsAt: new Date("2026-06-07T14:00:00.000Z"),
  endsAt: new Date("2026-06-07T14:30:00.000Z"),
  status: "scheduled"
};

describe("buildConversationState", () => {
  it("derives an idle state without active appointments or pending booking", () => {
    expect(
      buildConversationState({
        conversation: baseConversation,
        clinicProfile: profile,
        patient: { id: "pat_1", whatsappNumber: "+5491111111111" },
        activeAppointments: [],
        messageText: "hola"
      })
    ).toEqual({
      stage: "idle",
      hasPendingBooking: false,
      pendingBookingKind: "none",
      missingPatientFields: ["fullName"],
      activeAppointmentCount: 0,
      lastPatientMessage: "hola"
    });
  });

  it("derives an offering-slot state from a pending new booking", () => {
    expect(
      buildConversationState({
        conversation: {
          ...baseConversation,
          pendingBooking: {
            serviceId: "svc_botox",
            professionalId: "pro_perez",
            startsAt: new Date("2026-06-07T14:00:00.000Z"),
            endsAt: new Date("2026-06-07T14:30:00.000Z")
          }
        },
        clinicProfile: profile,
        patient: { id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" },
        activeAppointments: [],
        messageText: "si"
      })
    ).toEqual({
      stage: "offering_slot",
      hasPendingBooking: true,
      pendingBookingKind: "new_booking",
      selectedServiceId: "svc_botox",
      selectedProfessionalId: "pro_perez",
      offeredSlotStartsAt: "2026-06-07T14:00:00.000Z",
      missingPatientFields: [],
      activeAppointmentCount: 0,
      lastPatientMessage: "si"
    });
  });

  it("derives rescheduling, paused, and booked states from business context", () => {
    expect(
      buildConversationState({
        conversation: {
          ...baseConversation,
          pendingBooking: {
            appointmentId: "appt_1",
            serviceId: "svc_botox",
            professionalId: "pro_perez",
            startsAt: new Date("2026-06-08T14:00:00.000Z"),
            endsAt: new Date("2026-06-08T14:30:00.000Z")
          }
        },
        clinicProfile: profile,
        patient: { id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" },
        activeAppointments: [appointment],
        messageText: "mejor otro"
      }).stage
    ).toBe("rescheduling");

    expect(
      buildConversationState({
        conversation: { ...baseConversation, botPaused: true },
        clinicProfile: profile,
        patient: { id: "pat_1", whatsappNumber: "+5491111111111" },
        activeAppointments: [],
        messageText: "hola"
      }).stage
    ).toBe("paused");

    expect(
      buildConversationState({
        conversation: baseConversation,
        clinicProfile: profile,
        patient: { id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" },
        activeAppointments: [appointment],
        messageText: "hola"
      }).stage
    ).toBe("booked");
  });
});
