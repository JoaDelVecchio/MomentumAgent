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
});

async function buildReminderContext(input: {
  appointmentStartsAt: Date;
  conversation?: Partial<Conversation>;
  appointment?: Partial<Appointment>;
}) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
  const audit = new InMemoryAuditLog();
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });

  repos.upsertClinicProfile(clinicProfile());
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

function clinicProfile(): ClinicProfile {
  return parseClinicProfile({
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
