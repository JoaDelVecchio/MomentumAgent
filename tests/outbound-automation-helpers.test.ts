import { describe, expect, it } from "vitest";
import { isInsideQuietHours } from "../src/application/outbound/quiet-hours.js";
import { buildOutboundTemplate } from "../src/application/outbound/templates.js";

describe("outbound automation helpers", () => {
  it("detects quiet hours in the clinic timezone", () => {
    expect(
      isInsideQuietHours({
        now: new Date("2026-06-01T02:00:00.000Z"),
        timezone: "America/Argentina/Buenos_Aires"
      })
    ).toBe(true);
    expect(
      isInsideQuietHours({
        now: new Date("2026-06-01T15:00:00.000Z"),
        timezone: "America/Argentina/Buenos_Aires"
      })
    ).toBe(false);
  });

  it("treats matching quiet hour boundaries as disabled", () => {
    expect(
      isInsideQuietHours({
        now: new Date("2026-06-01T15:00:00.000Z"),
        timezone: "America/Argentina/Buenos_Aires",
        quietStartHour: 9,
        quietEndHour: 9
      })
    ).toBe(false);
  });

  it("builds Momentum-owned template payloads", () => {
    expect(
      buildOutboundTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        kind: "reminder_24h",
        parameters: {
          clinicName: "Clinica Demo",
          serviceName: "Botox",
          appointmentTimeText: "martes 2/6 15:00"
        }
      })
    ).toEqual({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "appointment_reminder_24h",
      languageCode: "es_AR",
      parameters: ["Clinica Demo", "Botox", "martes 2/6 15:00"]
    });

    expect(
      buildOutboundTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        kind: "freed_slot_offer",
        parameters: {
          clinicName: "Clinica Demo",
          serviceName: "Botox",
          appointmentTimeText: "martes 2/6 15:00"
        }
      })
    ).toEqual({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "freed_slot_offer",
      languageCode: "es_AR",
      parameters: ["Clinica Demo", "Botox", "martes 2/6 15:00"]
    });

    expect(
      buildOutboundTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        kind: "reactivation_1",
        parameters: {
          clinicName: "Clinica Demo",
          serviceName: "Botox"
        }
      })
    ).toEqual({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "lead_reactivation_1",
      languageCode: "es_AR",
      parameters: ["Clinica Demo", "Botox"]
    });
  });
});
