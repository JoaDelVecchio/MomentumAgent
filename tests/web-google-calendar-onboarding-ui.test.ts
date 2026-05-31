import { describe, expect, it } from "vitest";
import { calendarMappingWarnings } from "../apps/web/src/lib/google-calendar-onboarding-ui.js";
import type { GoogleCalendarSummary } from "../apps/web/src/lib/types.js";

describe("Google Calendar onboarding UI helpers", () => {
  it("warns when a reservable service uses a professional without a usable calendar", () => {
    expect(
      calendarMappingWarnings({
        calendars: [],
        professionals: [
          { id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" },
          { id: "pro_lopez", name: "Dr. Lopez" }
        ],
        services: [
          { id: "svc_botox", name: "Botox", professionalIds: ["pro_perez"] },
          { id: "svc_laser", name: "Laser", professionalIds: ["pro_lopez"] }
        ]
      }).unmappedServiceNames
    ).toEqual(["Laser"]);
  });

  it("treats existing calendar ids as usable until discovered calendars are loaded", () => {
    expect(
      calendarMappingWarnings({
        calendars: [],
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        services: [{ id: "svc_botox", name: "Botox", professionalIds: ["pro_perez"] }]
      }).unmappedServiceNames
    ).toEqual([]);
  });

  it("warns when loaded calendars show a mapped calendar is not bookable", () => {
    expect(
      calendarMappingWarnings({
        calendars: [calendar({ id: "cal_perez", summary: "Consulta Perez", bookable: false })],
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        services: [{ id: "svc_botox", name: "Botox", professionalIds: ["pro_perez"] }]
      })
    ).toMatchObject({
      nonBookableCalendarNames: ["Consulta Perez"],
      unmappedServiceNames: ["Botox"]
    });
  });

  it("reports duplicate calendar mappings from manual JSON edits", () => {
    expect(
      calendarMappingWarnings({
        calendars: [calendar({ id: "cal_shared", summary: "Shared", bookable: true })],
        professionals: [
          { id: "pro_perez", name: "Dra. Perez", calendarId: "cal_shared" },
          { id: "pro_lopez", name: "Dr. Lopez", calendarId: "cal_shared" }
        ],
        services: []
      }).duplicateCalendarIds
    ).toEqual(["cal_shared"]);
  });
});

function calendar(overrides: Partial<GoogleCalendarSummary>): GoogleCalendarSummary {
  return {
    id: "cal_default",
    summary: "Default",
    primary: false,
    accessRole: "writer",
    bookable: true,
    ...overrides
  };
}
