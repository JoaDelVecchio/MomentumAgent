import { describe, expect, it } from "vitest";
import { findProfessional } from "../src/application/conversations/service-matching.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

describe("findProfessional", () => {
  it("returns undefined for ambiguous generic professional preferences", () => {
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
          professionalIds: ["pro_perez", "pro_gomez"]
        }
      ],
      professionals: [
        { id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" },
        { id: "pro_gomez", name: "Dra. Gomez", calendarId: "cal_gomez" }
      ],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    });

    expect(findProfessional(profile, "Dra")).toBeUndefined();
  });
});
