import { describe, expect, it } from "vitest";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("clinic profile", () => {
  it("accepts one site, multiple professionals, and reservable services", () => {
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
          restrictions: ["No se brinda diagnostico por WhatsApp."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [
        {
          id: "pro_perez",
          name: "Dra. Perez",
          calendarId: "cal_perez"
        }
      ],
      appointmentRules: {
        minimumNoticeMinutes: 120,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0
      },
      requiredPatientFields: ["fullName"]
    });

    expect(profile.services[0]?.professionalIds).toEqual(["pro_perez"]);
  });

  it("rejects a service mapped to a missing professional", () => {
    expect(() =>
      parseClinicProfile({
        clinicId: "clinic_1",
        name: "Clinica Demo",
        timezone: "America/Argentina/Buenos_Aires",
        services: [
          {
            id: "svc_botox",
            name: "Botox",
            durationMinutes: 30,
            priceText: "Desde $120.000",
            preparation: "Sin preparacion especial.",
            restrictions: [],
            professionalIds: ["pro_missing"]
          }
        ],
        professionals: [],
        appointmentRules: {
          minimumNoticeMinutes: 120,
          cancellationNoticeMinutes: 1440,
          bufferMinutes: 0
        },
        requiredPatientFields: ["fullName"]
      })
    ).toThrow("Service svc_botox references missing professional pro_missing");
  });
});
