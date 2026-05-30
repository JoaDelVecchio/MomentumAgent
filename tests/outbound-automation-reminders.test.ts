import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../src/application/outbound/outbound-automation-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { Appointment, ClinicProfile } from "../src/domain/types.js";
import type { Conversation } from "../src/ports/repositories.js";

describe("OutboundAutomationService reminders", () => {
  it("sends a due 24h reminder exactly once", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z")
    });

    const firstSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });
    const duplicateSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(firstSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(duplicateSummary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        to: "+5491111111111",
        templateName: "appointment_reminder_24h",
        parameters: ["Clinica Demo", "Botox", expect.stringContaining("03/06")]
      })
    ]);
  });

  it("blocks reminders for opted-out patients and paused conversations", async () => {
    const optedOut = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z")
    });
    optedOut.repos.markOptOut("+5491111111111");

    const paused = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z"),
      conversation: { botPaused: true }
    });

    expect(
      await optedOut.service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(
      await paused.service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(optedOut.provider.sentTemplateMessages).toEqual([]);
    expect(paused.provider.sentTemplateMessages).toEqual([]);
  });

  it("blocks reminders during quiet hours", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T02:00:00.000Z")
    });

    const summary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T02:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([]);
  });

  it("does not consume the final reminder key during quiet hours", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T11:30:00.000Z")
    });

    const quietHoursSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T11:30:00.000Z")
    });

    expect(quietHoursSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toBeUndefined();

    const allowedHoursSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(allowedHoursSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({
        status: "sent",
        appointmentId: "appt_1",
        patientId: "pat_1"
      })
    );
    expect(context.provider.sentTemplateMessages).toHaveLength(1);
  });

  it("sends the 24h reminder at the next allowed hour after an 08:00 local due time is blocked", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T11:00:00.000Z")
    });

    const quietHoursSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T11:00:00.000Z")
    });

    expect(quietHoursSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toBeUndefined();

    const allowedHoursSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(allowedHoursSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        templateName: "appointment_reminder_24h"
      })
    ]);
  });

  it("only sends same-day reminders for long-duration services", async () => {
    const longDuration = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-02T15:00:00.000Z"),
      appointment: { endsAt: new Date("2026-06-02T16:00:00.000Z") },
      serviceDurationMinutes: 60
    });
    const defaultDuration = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-02T15:00:00.000Z")
    });

    expect(
      await longDuration.service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(longDuration.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        templateName: "appointment_reminder_same_day"
      })
    ]);

    expect(
      await defaultDuration.service.runDueReminders({
        clinicId: "clinic_1",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 0 });
    expect(defaultDuration.provider.sentTemplateMessages).toEqual([]);
  });

  it("blocks reminder when calendar event is cancelled", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z")
    });
    await context.calendar.cancelEvent("evt_1", "cal_perez");

    const summary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([]);
  });

  it("persists missing-patient reminder blocks and skips duplicate runs", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z"),
      appointment: { patientId: "pat_missing" }
    });

    const firstSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });
    const duplicateSummary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(firstSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(duplicateSummary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({
        status: "blocked",
        failureReason: "missing_patient",
        appointmentId: "appt_1",
        patientId: "pat_missing"
      })
    );
    expect(context.provider.sentTemplateMessages).toEqual([]);
  });

  it("records failed deliveries when WhatsApp sending fails", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z")
    });
    context.provider.failNextSend("kapso unavailable");

    const summary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 0, failed: 1, skipped: 0 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({
        status: "failed",
        failureReason: "kapso unavailable"
      })
    );
  });

  it("marks claimed deliveries failed when a post-claim dependency fails", async () => {
    const context = await buildReminderContext({
      appointmentStartsAt: new Date("2026-06-03T12:00:00.000Z")
    });
    context.calendar.getEvent = async () => {
      throw new Error("calendar unavailable");
    };

    const summary = await context.service.runDueReminders({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 0, failed: 1, skipped: 0 });
    expect(await context.repos.getOutboundDelivery("reminder:appt_1:24h")).toEqual(
      expect.objectContaining({
        status: "failed",
        failureReason: "calendar unavailable"
      })
    );
  });
});

async function buildReminderContext(input: {
  appointmentStartsAt: Date;
  conversation?: Partial<Conversation>;
  appointment?: Partial<Appointment>;
  serviceDurationMinutes?: number;
}) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
  const audit = new InMemoryAuditLog();
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });

  repos.upsertClinicProfile(clinicProfile(input.serviceDurationMinutes));
  repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
  repos.saveConversation({
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: false,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    updatedAt: new Date("2026-05-30T10:00:00.000Z"),
    ...input.conversation
  });

  const appointment = appointmentFixture({
    startsAt: input.appointmentStartsAt,
    ...input.appointment
  });
  calendar.seedAvailability("cal_perez", [
    { startsAt: appointment.startsAt, endsAt: appointment.endsAt }
  ]);
  await calendar.createEvent({
    calendarId: "cal_perez",
    summary: "Botox - Ana Gomez",
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    metadata: { appointmentId: "appt_1" }
  });
  repos.saveAppointment(appointment);

  return { repos, calendar, provider, audit, templateService, service };
}

function clinicProfile(serviceDurationMinutes = 30): ClinicProfile {
  return parseClinicProfile({
    clinicId: "clinic_1",
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        durationMinutes: serviceDurationMinutes,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: [],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 3, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function appointmentFixture(overrides: Partial<Appointment> = {}): Appointment {
  const startsAt = overrides.startsAt ?? new Date("2026-06-03T12:00:00.000Z");

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
