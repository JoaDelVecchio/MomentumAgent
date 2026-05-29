import { describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";

describe("FakeCalendar", () => {
  it("returns free slots that do not overlap existing events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Existing",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_existing" }
    });

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z"),
      durationMinutes: 30
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("filters slots by search window and requested duration", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T12:00:00.000Z"), endsAt: new Date("2026-06-01T12:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:15:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") },
      { startsAt: new Date("2026-06-01T15:00:00.000Z"), endsAt: new Date("2026-06-01T15:30:00.000Z") }
    ]);

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:00:00.000Z"),
      to: new Date("2026-06-01T14:30:00.000Z"),
      durationMinutes: 30
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("allows adjacent slots and ignores cancelled events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") },
      { startsAt: new Date("2026-06-01T14:00:00.000Z"), endsAt: new Date("2026-06-01T14:30:00.000Z") }
    ]);

    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Adjacent before",
      startsAt: new Date("2026-06-01T12:30:00.000Z"),
      endsAt: new Date("2026-06-01T13:00:00.000Z"),
      metadata: { appointmentId: "appt_before" }
    });
    const cancelled = await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Cancelled",
      startsAt: new Date("2026-06-01T13:30:00.000Z"),
      endsAt: new Date("2026-06-01T14:00:00.000Z"),
      metadata: { appointmentId: "appt_cancelled" }
    });
    await calendar.cancelEvent(cancelled.id);

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:00:00.000Z"),
      to: new Date("2026-06-01T14:30:00.000Z"),
      durationMinutes: 30
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      },
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z")
      }
    ]);
  });

  it("does not expose mutable date or metadata references", async () => {
    const calendar = new FakeCalendar();
    const seededSlot = {
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    };
    calendar.seedAvailability("cal_perez", [seededSlot]);
    seededSlot.startsAt.setUTCFullYear(2030);

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z"),
      durationMinutes: 30
    });
    slots[0]?.startsAt.setUTCFullYear(2031);

    const slotsAfterMutation = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z"),
      durationMinutes: 30
    });
    expect(slotsAfterMutation[0]?.startsAt).toEqual(new Date("2026-06-01T13:00:00.000Z"));

    const event = await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Immutable event",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_immutable" }
    });
    event.startsAt.setUTCFullYear(2032);
    event.metadata.appointmentId = "mutated";

    expect(await calendar.getEvent(event.id)).toEqual({
      calendarId: "cal_perez",
      summary: "Immutable event",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_immutable" },
      id: event.id,
      status: "scheduled"
    });
  });
});
