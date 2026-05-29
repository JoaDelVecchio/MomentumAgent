import { describe, expect, it } from "vitest";
import { parseClinicProfile, type ClinicProfileInput } from "../src/domain/clinic-profile.js";

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
          calendarId: "cal_perez",
          workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
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
    expect(profile.professionals[0]?.workingHours).toEqual([{ day: 1, startTime: "09:00", endTime: "17:00" }]);
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

  it("rejects professional working hours with invalid day or time formats", () => {
    const validProfile = {
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
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [
        {
          id: "pro_perez",
          name: "Dra. Perez",
          calendarId: "cal_perez",
          workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
        }
      ],
      appointmentRules: {
        minimumNoticeMinutes: 120,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0
      },
      requiredPatientFields: ["fullName"]
    } satisfies ClinicProfileInput;

    expect(() =>
      parseClinicProfile(
        {
          ...validProfile,
          professionals: [
            {
              id: "pro_perez",
              name: "Dra. Perez",
              calendarId: "cal_perez",
              workingHours: [{ day: 7, startTime: "09:00", endTime: "17:00" }]
            }
          ]
        } as unknown as ClinicProfileInput
      )
    ).toThrow();
    expect(() =>
      parseClinicProfile({
        ...validProfile,
        professionals: [
          {
            id: "pro_perez",
            name: "Dra. Perez",
            calendarId: "cal_perez",
            workingHours: [{ day: 1, startTime: "9:00", endTime: "17:00" }]
          }
        ]
      })
    ).toThrow();
    expect(() =>
      parseClinicProfile({
        ...validProfile,
        professionals: [
          {
            id: "pro_perez",
            name: "Dra. Perez",
            calendarId: "cal_perez",
            workingHours: [{ day: 1, startTime: "09:00", endTime: "24:00" }]
          }
        ]
      })
    ).toThrow();
  });

  it("rejects professional working hours when end time is not after start time", () => {
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
            professionalIds: ["pro_perez"]
          }
        ],
        professionals: [
          {
            id: "pro_perez",
            name: "Dra. Perez",
            calendarId: "cal_perez",
            workingHours: [{ day: 1, startTime: "17:00", endTime: "09:00" }]
          }
        ],
        appointmentRules: {
          minimumNoticeMinutes: 120,
          cancellationNoticeMinutes: 1440,
          bufferMinutes: 0
        },
        requiredPatientFields: ["fullName"]
      })
    ).toThrow("Working hour end time must be after start time");
  });
});
