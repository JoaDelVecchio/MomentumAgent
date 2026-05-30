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

describe("OutboundAutomationService reactivations", () => {
  it("reactivates an abandoned booking conversation after about 24h", async () => {
    const context = buildReactivationContext({
      conversation: {
        pendingBooking: pendingBookingFixture(),
        updatedAt: new Date("2026-06-01T10:00:00.000Z")
      }
    });

    const summary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        to: "+5491111111111",
        templateName: "lead_reactivation_1",
        parameters: ["Clinica Demo", "Botox"]
      })
    ]);
  });

  it("does not reactivate generic conversations without pending booking or interest", async () => {
    const context = buildReactivationContext();

    const summary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([]);
  });

  it("does not consume the first reactivation key during quiet hours", async () => {
    const context = buildReactivationContext({
      conversation: {
        pendingBooking: pendingBookingFixture(),
        updatedAt: new Date("2026-06-01T10:00:00.000Z")
      }
    });

    const quietHoursSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T11:30:00.000Z")
    });

    expect(quietHoursSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([]);
    expect(await context.repos.getOutboundDelivery("reactivation:conv_1:1")).toBeUndefined();

    const allowedHoursSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(allowedHoursSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        templateName: "lead_reactivation_1"
      })
    ]);
    expect(await context.repos.getOutboundDelivery("reactivation:conv_1:1")).toEqual(
      expect.objectContaining({
        status: "sent",
        conversationId: "conv_1",
        patientId: "pat_1"
      })
    );
  });

  it("does not consume the first reactivation key while handoff is paused", async () => {
    const context = buildReactivationContext({
      conversation: {
        botPaused: true,
        pendingBooking: pendingBookingFixture(),
        updatedAt: new Date("2026-06-01T10:00:00.000Z")
      }
    });

    const pausedSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(pausedSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([]);
    expect(await context.repos.getOutboundDelivery("reactivation:conv_1:1")).toBeUndefined();

    context.repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: false,
      pendingBooking: pendingBookingFixture(),
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:00:00.000Z")
    });

    const resumedSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:01:00.000Z")
    });

    expect(resumedSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        templateName: "lead_reactivation_1"
      })
    ]);
  });

  it("only blocks reactivation for future appointments in the same clinic", async () => {
    const otherClinicAppointment = buildReactivationContext({
      conversation: { pendingBooking: pendingBookingFixture() },
      appointment: appointmentFixture({
        id: "appt_other_clinic",
        clinicId: "clinic_2",
        startsAt: new Date("2026-06-10T12:00:00.000Z")
      })
    });

    const otherClinicSummary = await otherClinicAppointment.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(otherClinicSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(otherClinicAppointment.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        templateName: "lead_reactivation_1"
      })
    ]);

    const sameClinicAppointment = buildReactivationContext({
      conversation: { pendingBooking: pendingBookingFixture() },
      appointment: appointmentFixture({ startsAt: new Date("2026-06-10T12:00:00.000Z") })
    });

    const sameClinicSummary = await sameClinicAppointment.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(sameClinicSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(sameClinicAppointment.provider.sentTemplateMessages).toEqual([]);
    expect(await sameClinicAppointment.repos.getOutboundDelivery("reactivation:conv_1:1")).toEqual(
      expect.objectContaining({
        status: "blocked",
        failureReason: "future_appointment"
      })
    );

    const duplicateSummary = await sameClinicAppointment.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:01:00.000Z")
    });

    expect(duplicateSummary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
  });

  it("blocks reactivation for opt-out", async () => {
    const optedOut = buildReactivationContext({
      conversation: { pendingBooking: pendingBookingFixture() }
    });

    optedOut.repos.markOptOut("+5491111111111");

    const summary = await optedOut.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(summary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(optedOut.provider.sentTemplateMessages).toEqual([]);
    expect(await optedOut.repos.getOutboundDelivery("reactivation:conv_1:1")).toEqual(
      expect.objectContaining({
        status: "blocked",
        failureReason: "opt_out"
      })
    );
  });

  it("sends second attempt after seven days and then stops", async () => {
    const context = buildReactivationContext({
      conversation: {
        pendingBooking: pendingBookingFixture(),
        updatedAt: new Date("2026-06-01T10:00:00.000Z")
      }
    });

    const firstSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-02T12:00:00.000Z")
    });
    const secondSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-09T12:00:00.000Z")
    });
    const thirdSummary = await context.service.runDueReactivations({
      clinicId: "clinic_1",
      now: new Date("2026-06-16T12:00:00.000Z")
    });

    expect(firstSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(secondSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(thirdSummary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 0 });
    expect(context.provider.sentTemplateMessages.map((message) => message.templateName)).toEqual([
      "lead_reactivation_1",
      "lead_reactivation_2"
    ]);
  });
});

function buildReactivationContext(input: {
  conversation?: Partial<Conversation>;
  appointment?: Appointment;
} = {}) {
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
    updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    ...input.conversation
  });

  if (input.appointment) {
    repos.saveAppointment(input.appointment);
  }

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

function pendingBookingFixture() {
  return {
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    startsAt: new Date("2026-06-05T12:00:00.000Z"),
    endsAt: new Date("2026-06-05T12:30:00.000Z")
  };
}

function appointmentFixture(overrides: Partial<Appointment> = {}): Appointment {
  const startsAt = overrides.startsAt ?? new Date("2026-06-10T12:00:00.000Z");

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
