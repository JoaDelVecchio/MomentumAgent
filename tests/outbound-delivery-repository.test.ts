import { describe, expect, it } from "vitest";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import type { Appointment } from "../src/domain/types.js";
import type { Conversation } from "../src/ports/repositories.js";

describe("Outbound delivery repository contract", () => {
  it("claims an outbound delivery once and returns existing on duplicate claim", async () => {
    const repos = new InMemoryRepositories();
    const now = new Date("2026-05-30T12:00:00.000Z");

    const first = await repos.claimOutboundDelivery({
      key: "reminder:appt_1:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111111111",
      patientId: "pat_1",
      conversationId: "conv_1",
      appointmentId: "appt_1",
      templateName: "appointment_reminder_24h",
      metadata: { timezone: "America/Argentina/Buenos_Aires" },
      now
    });
    const duplicate = await repos.claimOutboundDelivery({
      key: "reminder:appt_1:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111111111",
      patientId: "pat_1",
      conversationId: "conv_1",
      appointmentId: "appt_1",
      templateName: "appointment_reminder_24h",
      metadata: { timezone: "mutated" },
      now: new Date("2026-05-30T13:00:00.000Z")
    });

    expect(first.kind).toBe("new");
    expect(first.delivery).toEqual(
      expect.objectContaining({
        id: "outbound_1",
        key: "reminder:appt_1:24h",
        clinicId: "clinic_1",
        automationType: "reminder",
        status: "claimed",
        metadata: { timezone: "America/Argentina/Buenos_Aires" },
        claimedAt: now,
        createdAt: now,
        updatedAt: now
      })
    );
    expect(duplicate).toEqual({ kind: "existing", delivery: first.delivery });
  });

  it("marks the delivery sent and reads sent status details back", async () => {
    const repos = new InMemoryRepositories();
    const key = "reminder:appt_1:24h";
    const sentAt = new Date("2026-05-30T12:05:00.000Z");

    await claimOutboundDelivery(repos, { key });

    await repos.markOutboundDeliverySent({ key, providerMessageId: "wamid_1", sentAt });

    expect(await repos.getOutboundDelivery(key)).toEqual(
      expect.objectContaining({
        key,
        status: "sent",
        providerMessageId: "wamid_1",
        sentAt,
        updatedAt: sentAt
      })
    );
  });

  it("marks the delivery blocked and reads blocked status details back", async () => {
    const repos = new InMemoryRepositories();
    const key = "reminder:appt_1:24h";
    const blockedAt = new Date("2026-05-30T12:10:00.000Z");

    await claimOutboundDelivery(repos, { key });

    await repos.markOutboundDeliveryBlocked({ key, reason: "patient opted out", blockedAt });

    expect(await repos.getOutboundDelivery(key)).toEqual(
      expect.objectContaining({
        key,
        status: "blocked",
        failureReason: "patient opted out",
        blockedAt,
        updatedAt: blockedAt
      })
    );
  });

  it("marks the delivery failed and reads failed status details back", async () => {
    const repos = new InMemoryRepositories();
    const key = "reminder:appt_1:24h";
    const failedAt = new Date("2026-05-30T12:15:00.000Z");

    await claimOutboundDelivery(repos, { key });

    await repos.markOutboundDeliveryFailed({ key, reason: "provider timeout", failedAt });

    expect(await repos.getOutboundDelivery(key)).toEqual(
      expect.objectContaining({
        key,
        status: "failed",
        failureReason: "provider timeout",
        failedAt,
        updatedAt: failedAt
      })
    );
  });

  it("does not allow terminal outbound delivery states to be overwritten", async () => {
    const repos = new InMemoryRepositories();
    const key = "reminder:appt_1:24h";
    const sentAt = new Date("2026-05-30T12:05:00.000Z");

    await claimOutboundDelivery(repos, { key });
    await repos.markOutboundDeliverySent({ key, providerMessageId: "wamid_1", sentAt });

    expect(() =>
      repos.markOutboundDeliveryFailed({
        key,
        reason: "provider timeout",
        failedAt: new Date("2026-05-30T12:15:00.000Z")
      })
    ).toThrow("Outbound delivery reminder:appt_1:24h is already sent");
    const delivery = await repos.getOutboundDelivery(key);
    expect(delivery).toEqual(
      expect.objectContaining({
        key,
        status: "sent",
        providerMessageId: "wamid_1",
        sentAt
      })
    );
    expect(delivery).not.toHaveProperty("failureReason");
    expect(delivery?.failedAt).toBeUndefined();
  });

  it("does not expose mutable outbound delivery metadata references", async () => {
    const repos = new InMemoryRepositories();
    const key = "reminder:appt_1:24h";

    await claimOutboundDelivery(repos, { key });

    const delivery = await repos.getOutboundDelivery(key);
    delivery!.metadata.timezone = "mutated";

    expect(await repos.getOutboundDelivery(key)).toEqual(
      expect.objectContaining({
        metadata: { timezone: "America/Argentina/Buenos_Aires" }
      })
    );
  });

  it("lists scheduled appointments for a clinic and time window", async () => {
    const repos = new InMemoryRepositories();
    const appointment = appointmentFixture({
      id: "appt_1",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    });
    repos.saveAppointment(appointmentFixture({ id: "appt_later", startsAt: new Date("2026-06-01T14:00:00.000Z") }));
    repos.saveAppointment(appointment);
    repos.saveAppointment(
      appointmentFixture({ id: "appt_other_clinic", clinicId: "clinic_2", startsAt: new Date("2026-06-01T13:15:00.000Z") })
    );
    repos.saveAppointment(
      appointmentFixture({ id: "appt_cancelled", status: "cancelled", startsAt: new Date("2026-06-01T13:20:00.000Z") })
    );
    repos.saveAppointment(appointmentFixture({ id: "appt_outside", startsAt: new Date("2026-06-01T15:00:00.000Z") }));

    const scheduledAppointments = await repos.listScheduledAppointments({
      clinicId: "clinic_1",
      from: new Date("2026-06-01T13:00:00.000Z"),
      to: new Date("2026-06-01T14:00:00.000Z")
    });

    expect(scheduledAppointments).toEqual([
      expect.objectContaining({ id: "appt_1", startsAt: new Date("2026-06-01T13:00:00.000Z") }),
      expect.objectContaining({ id: "appt_later", startsAt: new Date("2026-06-01T14:00:00.000Z") })
    ]);
  });

  it("lists conversations by clinic and by clinic plus patient", async () => {
    const repos = new InMemoryRepositories();
    repos.saveConversation(conversationFixture({ id: "conv_old", updatedAt: new Date("2026-05-30T11:00:00.000Z") }));
    repos.saveConversation(conversationFixture({ id: "conv_new", updatedAt: new Date("2026-05-30T12:00:00.000Z") }));
    repos.saveConversation(
      conversationFixture({ id: "conv_other_patient", patientId: "pat_2", updatedAt: new Date("2026-05-30T13:00:00.000Z") })
    );
    repos.saveConversation(
      conversationFixture({ id: "conv_other_clinic", clinicId: "clinic_2", updatedAt: new Date("2026-05-30T14:00:00.000Z") })
    );

    expect(await repos.listConversationsByClinic("clinic_1")).toEqual([
      expect.objectContaining({ id: "conv_old" }),
      expect.objectContaining({ id: "conv_new" }),
      expect.objectContaining({ id: "conv_other_patient" })
    ]);
    expect(await repos.listConversationsByPatient({ clinicId: "clinic_1", patientId: "pat_1" })).toEqual([
      expect.objectContaining({ id: "conv_new" }),
      expect.objectContaining({ id: "conv_old" })
    ]);
  });
});

function appointmentFixture(overrides: Partial<Appointment> = {}): Appointment {
  const startsAt = overrides.startsAt ?? new Date("2026-06-01T13:00:00.000Z");
  return {
    id: "appt_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    calendarEventId: "evt_1",
    calendarId: "cal_perez",
    startsAt,
    endsAt: overrides.endsAt ?? new Date(startsAt.getTime() + 30 * 60 * 1000),
    status: "scheduled",
    ...overrides
  };
}

function conversationFixture(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: false,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    updatedAt: new Date("2026-05-30T10:00:00.000Z"),
    ...overrides
  };
}

function claimOutboundDelivery(repos: InMemoryRepositories, overrides: { key?: string } = {}) {
  return repos.claimOutboundDelivery({
    key: overrides.key ?? "reminder:appt_1:24h",
    clinicId: "clinic_1",
    automationType: "reminder",
    toWhatsappNumber: "+5491111111111",
    patientId: "pat_1",
    conversationId: "conv_1",
    appointmentId: "appt_1",
    templateName: "appointment_reminder_24h",
    metadata: { timezone: "America/Argentina/Buenos_Aires" },
    now: new Date("2026-05-30T12:00:00.000Z")
  });
}
