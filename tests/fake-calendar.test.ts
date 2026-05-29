import { describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { CalendarAvailabilityError } from "../src/ports/calendar.js";

describe("FakeCalendar", () => {
  const availabilityContext = {
    timezone: "America/Argentina/Buenos_Aires",
    professionals: [],
    serviceDurationMinutes: 30,
    bufferMinutes: 0
  };

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
      durationMinutes: 30,
      availabilityContext
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
      durationMinutes: 30,
      availabilityContext
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("returns the first requested-duration slot inside a longer availability window", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:00:00.000Z"),
      to: new Date("2026-06-01T13:30:00.000Z"),
      durationMinutes: 30,
      availabilityContext
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      }
    ]);
  });

  it("clips an availability window to the search start", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:30:00.000Z"),
      to: new Date("2026-06-01T14:00:00.000Z"),
      durationMinutes: 30,
      availabilityContext
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("returns later aligned slots when the search starts inside an occupied segment", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);
    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Booked first half",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_first" }
    });

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:15:00.000Z"),
      to: new Date("2026-06-01T14:00:00.000Z"),
      durationMinutes: 30,
      availabilityContext
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("returns later slots from a longer window when an earlier segment is booked", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);
    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Booked first half",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_first" }
    });

    const slots = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T13:00:00.000Z"),
      to: new Date("2026-06-01T14:00:00.000Z"),
      durationMinutes: 30,
      availabilityContext
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:30:00.000Z"),
        endsAt: new Date("2026-06-01T14:00:00.000Z")
      }
    ]);
  });

  it("rejects creating overlapping or outside-availability events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Booked",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_booked" }
    });

    await expect(
      calendar.createEvent({
        calendarId: "cal_perez",
        summary: "Overlap",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z"),
        metadata: { appointmentId: "appt_overlap" }
      })
    ).rejects.toThrow(CalendarAvailabilityError);

    await expect(
      calendar.createEvent({
        calendarId: "cal_perez",
        summary: "Outside",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z"),
        metadata: { appointmentId: "appt_outside" }
      })
    ).rejects.toThrow(CalendarAvailabilityError);
  });

  it("rejects updating cancelled events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    const event = await calendar.createEvent({
      calendarId: "cal_perez",
      summary: "Booked",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      metadata: { appointmentId: "appt_booked" }
    });

    await calendar.cancelEvent(event.id);

    await expect(
      calendar.updateEvent(event.id, {
        calendarId: "cal_perez",
        summary: "Updated",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z"),
        metadata: { appointmentId: "appt_booked" }
      })
    ).rejects.toThrow(CalendarAvailabilityError);
  });

  it("allows adjacent slots and ignores cancelled events", async () => {
    const calendar = new FakeCalendar();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T12:30:00.000Z"), endsAt: new Date("2026-06-01T13:00:00.000Z") },
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
      durationMinutes: 30,
      availabilityContext
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
      durationMinutes: 30,
      availabilityContext
    });
    slots[0]?.startsAt.setUTCFullYear(2031);

    const slotsAfterMutation = await calendar.findFreeSlots({
      calendarIds: ["cal_perez"],
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z"),
      durationMinutes: 30,
      availabilityContext
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
