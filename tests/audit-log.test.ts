import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";

describe("InMemoryAuditLog", () => {
  it("records ordered audit events", async () => {
    const audit = new InMemoryAuditLog();

    await audit.record({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      type: "appointment.created",
      message: "Created appointment",
      metadata: { appointmentId: "appt_1" }
    });
    await audit.record({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      type: "appointment.cancelled",
      message: "Cancelled appointment",
      metadata: { appointmentId: "appt_1" }
    });

    expect(await audit.list()).toEqual([
      expect.objectContaining({
        id: "audit_1",
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "appointment.created",
        message: "Created appointment",
        metadata: { appointmentId: "appt_1" }
      }),
      expect.objectContaining({
        id: "audit_2",
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "appointment.cancelled",
        message: "Cancelled appointment",
        metadata: { appointmentId: "appt_1" }
      })
    ]);
  });

  it("does not expose mutable metadata or createdAt references", async () => {
    const audit = new InMemoryAuditLog();
    const metadata = { appointmentId: "appt_1" };

    const event = await audit.record({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      type: "appointment.created",
      message: "Created appointment",
      metadata
    });
    metadata.appointmentId = "mutated_from_input";
    event.metadata.appointmentId = "mutated_from_return";
    event.createdAt.setUTCFullYear(2030);

    const listed = await audit.list();
    listed[0]!.metadata.appointmentId = "mutated_from_list";
    listed[0]!.createdAt.setUTCFullYear(2031);

    expect(await audit.list()).toEqual([
      expect.objectContaining({
        id: "audit_1",
        metadata: { appointmentId: "appt_1" },
        createdAt: expect.any(Date)
      })
    ]);
    expect((await audit.list())[0]!.createdAt.getUTCFullYear()).not.toBe(2031);
  });
});

describe("InMemoryRepositories", () => {
  it("does not expose mutable repository entity references", () => {
    const repos = new InMemoryRepositories();
    const startsAt = new Date("2026-06-01T13:00:00.000Z");
    const endsAt = new Date("2026-06-01T13:30:00.000Z");
    const appointment = {
      id: "appt_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "evt_1",
      calendarId: "cal_perez",
      startsAt,
      endsAt,
      status: "scheduled" as const
    };

    repos.saveAppointment(appointment);
    startsAt.setUTCFullYear(2030);

    const savedAppointment = repos.getAppointment("appt_1");
    savedAppointment?.startsAt.setUTCFullYear(2031);

    expect(repos.getAppointment("appt_1")?.startsAt).toEqual(new Date("2026-06-01T13:00:00.000Z"));

    const listedAppointment = repos.listAppointmentsByPatient("pat_1")[0];
    listedAppointment?.endsAt.setUTCFullYear(2032);

    expect(repos.getAppointment("appt_1")?.endsAt).toEqual(new Date("2026-06-01T13:30:00.000Z"));
  });

  it("does not expose mutable patient interest references", () => {
    const repos = new InMemoryRepositories();
    const preferredFrom = new Date("2026-06-01T13:00:00.000Z");
    const interest = {
      id: "interest_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      preferredFrom,
      preferredTo: new Date("2026-06-01T15:00:00.000Z"),
      status: "active" as const
    };

    repos.saveInterest(interest);
    preferredFrom.setUTCFullYear(2030);

    const listedInterest = repos.listActiveInterests()[0];
    listedInterest?.preferredFrom.setUTCFullYear(2031);

    expect(repos.listActiveInterests()[0]?.preferredFrom).toEqual(new Date("2026-06-01T13:00:00.000Z"));
  });
});
