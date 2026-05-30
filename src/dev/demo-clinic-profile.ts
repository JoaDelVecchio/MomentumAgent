import { parseClinicProfile } from "../domain/clinic-profile.js";

export function buildDemoClinicProfile(clinicId = "clinic_1") {
  return parseClinicProfile({
    clinicId,
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        durationMinutes: 30,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [
          { day: 1, startTime: "09:00", endTime: "17:00" },
          { day: 2, startTime: "09:00", endTime: "17:00" },
          { day: 3, startTime: "09:00", endTime: "17:00" },
          { day: 4, startTime: "09:00", endTime: "17:00" },
          { day: 5, startTime: "09:00", endTime: "17:00" }
        ]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
