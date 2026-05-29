import { describe, expect, it } from "vitest";
import { generateWorkingHourSlots } from "../src/application/scheduling/slot-generator.js";
import type { Professional } from "../src/domain/types.js";

const timezone = "America/Argentina/Buenos_Aires";

function professional(workingHours: Professional["workingHours"]): Professional {
  return {
    id: "pro_perez",
    name: "Dra. Perez",
    calendarId: "cal_perez",
    workingHours
  };
}

describe("generateWorkingHourSlots", () => {
  it("produces UTC slots from a Monday local working window", () => {
    const slots = generateWorkingHourSlots({
      timezone,
      professionals: [professional([{ day: 1, startTime: "09:00", endTime: "12:00" }])],
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
      serviceDurationMinutes: 30,
      bufferMinutes: 0,
      busyIntervals: []
    });

    expect(slots).toEqual([
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T12:00:00.000Z"),
        endsAt: new Date("2026-06-01T12:30:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T12:30:00.000Z"),
        endsAt: new Date("2026-06-01T13:00:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z")
      },
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:30:00.000Z"),
        endsAt: new Date("2026-06-01T15:00:00.000Z")
      }
    ]);
  });

  it("removes candidate slots that overlap busy intervals", () => {
    const slots = generateWorkingHourSlots({
      timezone,
      professionals: [professional([{ day: 1, startTime: "09:00", endTime: "10:30" }])],
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
      serviceDurationMinutes: 30,
      bufferMinutes: 0,
      busyIntervals: [
        {
          calendarId: "cal_perez",
          startsAt: new Date("2026-06-01T12:15:00.000Z"),
          endsAt: new Date("2026-06-01T12:45:00.000Z")
        }
      ]
    });

    expect(slots).toEqual([
      {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      }
    ]);
  });

  it("uses buffer minutes in the blocked duration while returning the service appointment end", () => {
    const slots = generateWorkingHourSlots({
      timezone,
      professionals: [professional([{ day: 1, startTime: "09:00", endTime: "10:00" }])],
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
      serviceDurationMinutes: 30,
      bufferMinutes: 15,
      busyIntervals: [
        {
          calendarId: "cal_perez",
          startsAt: new Date("2026-06-01T12:30:00.000Z"),
          endsAt: new Date("2026-06-01T12:45:00.000Z")
        }
      ]
    });

    expect(slots).toEqual([]);
  });

  it("returns no slots when professionals have empty working hours", () => {
    const slots = generateWorkingHourSlots({
      timezone,
      professionals: [professional([])],
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
      serviceDurationMinutes: 30,
      bufferMinutes: 0,
      busyIntervals: []
    });

    expect(slots).toEqual([]);
  });
});
