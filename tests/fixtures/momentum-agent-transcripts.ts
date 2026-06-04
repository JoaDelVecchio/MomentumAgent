import type { AgentActionType } from "../../src/application/conversations/agent-router.js";
import type { ConversationUnderstanding } from "../../src/application/conversations/interpreter.js";

export type TranscriptAvailability = {
  calendarId: string;
  startsAt: string;
  endsAt: string;
};

export type TranscriptScheduledAppointment = {
  id: string;
  eventId: string;
  serviceId: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
};

export type TranscriptTurn = {
  text: string;
  understanding: Partial<ConversationUnderstanding>;
  expectedAction: AgentActionType;
  expectedReplyIncludes: string[];
  expectedReplyExcludes?: string[];
  expectedPendingStartsAt?: string;
  expectedPendingCleared?: boolean;
  expectedAppointmentCount?: number;
  expectedAppointmentStartsAt?: string;
  expectedPatientFullName?: string;
  expectedBotPaused?: boolean;
};

export type MomentumAgentTranscriptCase = {
  name: string;
  patientId: string;
  conversationId: string;
  initialPatientFullName?: string;
  availability: TranscriptAvailability[];
  scheduledAppointments?: TranscriptScheduledAppointment[];
  pendingBooking?: {
    serviceId: string;
    professionalId: string;
    startsAt: string;
    endsAt: string;
  };
  turns: TranscriptTurn[];
};

export const momentumAgentTranscriptCases: MomentumAgentTranscriptCase[] = [
  {
    name: "booking with FAQ, patient data, and confirmation",
    patientId: "pat_booking",
    conversationId: "conv_booking",
    availability: [
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T16:00:00.000Z",
        endsAt: "2026-06-03T16:30:00.000Z"
      }
    ],
    turns: [
      {
        text: "Hola, quiero reservar botox",
        understanding: { intent: "book", serviceName: "Botox" },
        expectedAction: "search_slots",
        expectedReplyIncludes: ["Tengo este horario", "13:00", "Botox"],
        expectedPendingStartsAt: "2026-06-03T16:00:00.000Z",
        expectedAppointmentCount: 0
      },
      {
        text: "cuanto sale y cuanto dura?",
        understanding: { intent: "question", requestedTopics: ["price", "duration"] },
        expectedAction: "answer_pending_faq",
        expectedReplyIncludes: ["Botox", "Desde $120.000", "30 minutos"],
        expectedPendingStartsAt: "2026-06-03T16:00:00.000Z",
        expectedAppointmentCount: 0
      },
      {
        text: "si, ese",
        understanding: { intent: "confirm" },
        expectedAction: "confirm_pending_booking",
        expectedReplyIncludes: ["nombre y apellido"],
        expectedPendingStartsAt: "2026-06-03T16:00:00.000Z",
        expectedAppointmentCount: 0
      },
      {
        text: "Ana Gomez",
        understanding: { intent: "unknown", patientFullName: "Ana Gomez" },
        expectedAction: "complete_pending_patient_data",
        expectedReplyIncludes: ["Turno confirmado", "13:00"],
        expectedPendingCleared: true,
        expectedAppointmentCount: 1,
        expectedAppointmentStartsAt: "2026-06-03T16:00:00.000Z",
        expectedPatientFullName: "Ana Gomez"
      }
    ]
  },
  {
    name: "reschedule with slot refinement and confirmation",
    patientId: "pat_reschedule",
    conversationId: "conv_reschedule",
    initialPatientFullName: "Ana Gomez",
    availability: [
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T10:00:00.000Z",
        endsAt: "2026-06-03T10:30:00.000Z"
      },
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T15:00:00.000Z",
        endsAt: "2026-06-03T15:30:00.000Z"
      },
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-04T15:00:00.000Z",
        endsAt: "2026-06-04T15:30:00.000Z"
      }
    ],
    scheduledAppointments: [
      {
        id: "appt_reschedule",
        eventId: "evt_reschedule",
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: "2026-06-03T10:00:00.000Z",
        endsAt: "2026-06-03T10:30:00.000Z"
      }
    ],
    turns: [
      {
        text: "quiero cambiar mi turno",
        understanding: { intent: "reschedule" },
        expectedAction: "reschedule_appointment",
        expectedReplyIncludes: ["Tengo este nuevo horario", "12:00"],
        expectedPendingStartsAt: "2026-06-03T15:00:00.000Z",
        expectedAppointmentStartsAt: "2026-06-03T10:00:00.000Z"
      },
      {
        text: "mejor manana a la tarde",
        understanding: {
          intent: "slot_refinement",
          timePreference: "manana a la tarde",
          normalizedTimePreference: {
            from: new Date("2026-06-04T03:00:00.000Z"),
            to: new Date("2026-06-05T03:00:00.000Z"),
            daypart: "afternoon"
          }
        },
        expectedAction: "refine_pending_slot",
        expectedReplyIncludes: ["12:00"],
        expectedPendingStartsAt: "2026-06-04T15:00:00.000Z",
        expectedAppointmentStartsAt: "2026-06-03T10:00:00.000Z"
      },
      {
        text: "si",
        understanding: { intent: "confirm" },
        expectedAction: "confirm_pending_booking",
        expectedReplyIncludes: ["Turno reprogramado", "12:00"],
        expectedPendingCleared: true,
        expectedAppointmentCount: 1,
        expectedAppointmentStartsAt: "2026-06-04T15:00:00.000Z"
      }
    ]
  },
  {
    name: "medical safety overrides mixed booking and smalltalk",
    patientId: "pat_safety",
    conversationId: "conv_safety",
    availability: [
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T16:00:00.000Z",
        endsAt: "2026-06-03T16:30:00.000Z"
      }
    ],
    turns: [
      {
        text: "quiero botox, estoy embarazada, como te llamas?",
        understanding: { intent: "book", serviceName: "Botox" },
        expectedAction: "handoff",
        expectedReplyIncludes: ["Te derivo con recepcion"],
        expectedAppointmentCount: 0,
        expectedBotPaused: true
      }
    ]
  },
  {
    name: "low-confidence confirmation does not mutate pending booking",
    patientId: "pat_low_confidence",
    conversationId: "conv_low_confidence",
    initialPatientFullName: "Ana Gomez",
    availability: [
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T16:00:00.000Z",
        endsAt: "2026-06-03T16:30:00.000Z"
      }
    ],
    pendingBooking: {
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      startsAt: "2026-06-03T16:00:00.000Z",
      endsAt: "2026-06-03T16:30:00.000Z"
    },
    turns: [
      {
        text: "si",
        understanding: { intent: "confirm", confidence: 0.1 },
        expectedAction: "clarify_low_confidence",
        expectedReplyIncludes: ["No llegue a entenderlo con seguridad"],
        expectedPendingStartsAt: "2026-06-03T16:00:00.000Z",
        expectedAppointmentCount: 0
      }
    ]
  },
  {
    name: "unknown text during a pending offer gets a contextual fallback",
    patientId: "pat_contextual",
    conversationId: "conv_contextual",
    initialPatientFullName: "Ana Gomez",
    availability: [
      {
        calendarId: "cal_perez",
        startsAt: "2026-06-03T16:00:00.000Z",
        endsAt: "2026-06-03T16:30:00.000Z"
      }
    ],
    pendingBooking: {
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      startsAt: "2026-06-03T16:00:00.000Z",
      endsAt: "2026-06-03T16:30:00.000Z"
    },
    turns: [
      {
        text: "ok dale",
        understanding: { intent: "unknown" },
        expectedAction: "reply_contextual_fallback",
        expectedReplyIncludes: ["Te mantengo el horario ofrecido"],
        expectedReplyExcludes: ["Decime que tratamiento te interesa"],
        expectedPendingStartsAt: "2026-06-03T16:00:00.000Z",
        expectedAppointmentCount: 0
      }
    ]
  }
];
