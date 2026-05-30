import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
import { OutboundAutomationService } from "../src/application/outbound/outbound-automation-service.js";
import { SchedulingService, type FreedSlotHandler } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { Appointment, ClinicProfile, TimeSlot } from "../src/domain/types.js";
import type { Conversation, PatientInterest } from "../src/ports/repositories.js";

describe("OutboundAutomationService freed-slot offers", () => {
  it("offers a freed slot to the best matching active interest once", async () => {
    const context = buildFreedSlotContext();

    const firstSummary = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: freedSlot(),
      now: new Date("2026-06-04T12:00:00.000Z")
    });
    const duplicateSummary = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: freedSlot(),
      now: new Date("2026-06-04T12:00:00.000Z")
    });

    expect(firstSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(duplicateSummary).toEqual({ sent: 0, blocked: 0, failed: 0, skipped: 1 });
    expect(context.provider.sentTemplateMessages).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        to: "+5491111111111",
        templateName: "freed_slot_offer",
        parameters: ["Clinica Demo", "Botox", expect.stringContaining("05/06")]
      })
    ]);
  });

  it("does not offer freed slots to opted-out or paused patients", async () => {
    const optedOut = buildFreedSlotContext();
    optedOut.repos.markOptOut("+5491111111111");

    const paused = buildFreedSlotContext({
      conversation: { botPaused: true }
    });

    expect(
      await optedOut.service.handleFreedSlot({
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        sourceAppointmentId: "appt_cancelled",
        slot: freedSlot(),
        now: new Date("2026-06-04T12:00:00.000Z")
      })
    ).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(
      await paused.service.handleFreedSlot({
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        sourceAppointmentId: "appt_cancelled",
        slot: freedSlot(),
        now: new Date("2026-06-04T12:00:00.000Z")
      })
    ).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });

    expect(await optedOut.repos.getOutboundDelivery(freedSlotDeliveryKey())).toEqual(
      expect.objectContaining({
        status: "blocked",
        failureReason: "opt_out"
      })
    );
    expect(await paused.repos.getOutboundDelivery(freedSlotDeliveryKey())).toBeUndefined();
    expect(optedOut.provider.sentTemplateMessages).toEqual([]);
    expect(paused.provider.sentTemplateMessages).toEqual([]);
  });

  it("does not consume the freed-slot key during quiet hours", async () => {
    const context = buildFreedSlotContext();

    const quietHoursSummary = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: freedSlot(),
      now: new Date("2026-06-04T11:30:00.000Z")
    });

    expect(quietHoursSummary).toEqual({ sent: 0, blocked: 1, failed: 0, skipped: 0 });
    expect(await context.repos.getOutboundDelivery(freedSlotDeliveryKey())).toBeUndefined();

    const allowedHoursSummary = await context.service.handleFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      sourceAppointmentId: "appt_cancelled",
      slot: freedSlot(),
      now: new Date("2026-06-04T12:00:00.000Z")
    });

    expect(allowedHoursSummary).toEqual({ sent: 1, blocked: 0, failed: 0, skipped: 0 });
    expect(await context.repos.getOutboundDelivery(freedSlotDeliveryKey())).toEqual(
      expect.objectContaining({
        status: "sent",
        patientId: "pat_1"
      })
    );
  });
});

describe("SchedulingService freed-slot trigger", () => {
  it("triggers freed-slot handling after successful cancellation", async () => {
    const context = buildSchedulingContext();
    const appointment = await context.service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    await context.service.cancelAppointment({ clinicId: "clinic_1", appointmentId: appointment.id });

    expect(context.freedSlotHandler.calls).toEqual([
      {
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        sourceAppointmentId: appointment.id,
        slot: {
          professionalId: "pro_perez",
          calendarId: "cal_perez",
          startsAt: new Date("2026-06-05T13:00:00.000Z"),
          endsAt: new Date("2026-06-05T13:30:00.000Z")
        }
      }
    ]);
  });

  it("triggers freed-slot handling for the old slot after successful reschedule", async () => {
    const context = buildSchedulingContext();
    context.calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-05T13:00:00.000Z"), endsAt: new Date("2026-06-05T13:30:00.000Z") },
      { startsAt: new Date("2026-06-06T14:00:00.000Z"), endsAt: new Date("2026-06-06T14:30:00.000Z") }
    ]);
    const appointment = await context.service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    await context.service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: appointment.id,
      startsAt: new Date("2026-06-06T14:00:00.000Z")
    });

    expect(context.freedSlotHandler.calls).toEqual([
      {
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        sourceAppointmentId: appointment.id,
        slot: {
          professionalId: "pro_perez",
          calendarId: "cal_perez",
          startsAt: new Date("2026-06-05T13:00:00.000Z"),
          endsAt: new Date("2026-06-05T13:30:00.000Z")
        }
      }
    ]);
  });

  it("audits freed-slot trigger failures without failing cancellation", async () => {
    const context = buildSchedulingContext(new FailingFreedSlotHandler());
    const appointment = await context.service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-05T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    const cancelled = await context.service.cancelAppointment({ clinicId: "clinic_1", appointmentId: appointment.id });

    expect(cancelled.status).toBe("cancelled");
    expect(await context.audit.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "outbound.freed_slot.failed",
          metadata: expect.objectContaining({
            appointmentId: appointment.id,
            serviceId: "svc_botox",
            reason: "kapso unavailable"
          })
        })
      ])
    );
  });
});

function buildFreedSlotContext(input: { conversation?: Partial<Conversation> } = {}) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const provider = new FakeWhatsAppProvider();
  const audit = new InMemoryAuditLog();
  const templateService = new OutboundTemplateService({ repos, provider, audit });
  const service = new OutboundAutomationService({ repos, calendar, templateService, audit });

  repos.upsertClinicProfile(clinicProfile());
  repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
  repos.upsertPatient({ id: "pat_2", whatsappNumber: "+5491111112222", fullName: "Beto Ruiz" });
  repos.saveConversation({
    id: "conv_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    botPaused: false,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    updatedAt: new Date("2026-05-30T10:00:00.000Z"),
    ...input.conversation
  });
  repos.saveInterest(interestFixture());
  repos.saveInterest(
    interestFixture({
      id: "interest_2",
      patientId: "pat_2",
      professionalId: undefined,
      preferredFrom: new Date("2026-06-01T00:00:00.000Z"),
      preferredTo: new Date("2026-06-30T00:00:00.000Z")
    })
  );

  return { repos, calendar, provider, audit, templateService, service };
}

function buildSchedulingContext<T extends FreedSlotHandler = CapturingFreedSlotHandler>(freedSlotHandler?: T) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();
  const handler = freedSlotHandler ?? new CapturingFreedSlotHandler();
  const service = new SchedulingService(
    repos,
    calendar,
    audit,
    () => new Date("2026-06-04T12:00:00.000Z"),
    handler
  );

  repos.upsertClinicProfile(clinicProfile());
  repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-05T13:00:00.000Z"), endsAt: new Date("2026-06-05T13:30:00.000Z") }
  ]);

  return { repos, calendar, audit, service, freedSlotHandler: handler as T };
}

class CapturingFreedSlotHandler implements FreedSlotHandler {
  readonly calls: Array<{
    clinicId: string;
    serviceId: string;
    sourceAppointmentId: string;
    slot: TimeSlot;
  }> = [];

  async handleFreedSlot(input: {
    clinicId: string;
    serviceId: string;
    sourceAppointmentId: string;
    slot: TimeSlot;
  }) {
    this.calls.push(input);
  }
}

class FailingFreedSlotHandler implements FreedSlotHandler {
  async handleFreedSlot() {
    throw new Error("kapso unavailable");
  }
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
        workingHours: [{ day: 5, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function freedSlot(): TimeSlot {
  return {
    professionalId: "pro_perez",
    calendarId: "cal_perez",
    startsAt: new Date("2026-06-05T13:00:00.000Z"),
    endsAt: new Date("2026-06-05T13:30:00.000Z")
  };
}

function interestFixture(overrides: Partial<PatientInterest> = {}): PatientInterest {
  return {
    id: "interest_1",
    clinicId: "clinic_1",
    patientId: "pat_1",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
    preferredTo: new Date("2026-06-05T14:00:00.000Z"),
    status: "active",
    ...overrides
  };
}

function freedSlotDeliveryKey() {
  return "freed-slot:appt_cancelled:interest_1:2026-06-05T13:00:00.000Z";
}
