import type { AuditLogPort } from "../../ports/audit-log.js";
import type { CalendarPort } from "../../ports/calendar.js";
import type { OperationalRepository, OutboundDeliveryRecord } from "../../ports/repositories.js";
import type { Appointment, ClinicProfile, Patient } from "../../domain/types.js";
import { OutboundTemplateService } from "../messaging/outbound-template-service.js";
import { isInsideQuietHours } from "./quiet-hours.js";
import { type ReminderKind, shouldSendReminder } from "./reminder-policy.js";
import { buildOutboundTemplate } from "./templates.js";

export type OutboundAutomationSummary = {
  sent: number;
  blocked: number;
  failed: number;
  skipped: number;
};

export type OutboundAutomationServiceOptions = {
  repos: OperationalRepository;
  calendar: CalendarPort;
  templateService: OutboundTemplateService;
  audit: AuditLogPort;
};

type ReminderBlockReason =
  | "missing_patient"
  | "opt_out"
  | "quiet_hours"
  | "handoff_paused"
  | "calendar_event_cancelled"
  | "missing_service";

type ReminderTemplateKind = "reminder_72h" | "reminder_24h" | "reminder_same_day";

export class OutboundAutomationService {
  constructor(private readonly options: OutboundAutomationServiceOptions) {}

  async runDueReminders(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    const profile = await this.requireProfile(input.clinicId);
    const summary = emptySummary();
    const appointments = await this.options.repos.listScheduledAppointments({
      clinicId: input.clinicId,
      from: input.now,
      to: new Date(input.now.getTime() + 73 * 60 * 60 * 1000)
    });

    for (const appointment of appointments) {
      const alreadySent = await this.sentReminderKinds(appointment.id);
      const kind = shouldSendReminder({
        now: input.now,
        appointmentTime: appointment.startsAt,
        sameDayRisk: false,
        alreadySent
      });
      const dueKind = shouldSendReminder({
        now: input.now,
        appointmentTime: appointment.startsAt,
        sameDayRisk: false
      });

      if (kind === "none" && dueKind === "none") {
        continue;
      }

      const selectedKind = kind === "none" ? dueKind : kind;
      if (selectedKind === "none") {
        continue;
      }

      await this.processReminder({
        appointment,
        profile,
        kind: selectedKind,
        now: input.now,
        summary
      });
    }

    return summary;
  }

  private async processReminder(input: {
    appointment: Appointment;
    profile: ClinicProfile;
    kind: Exclude<ReminderKind, "none">;
    now: Date;
    summary: OutboundAutomationSummary;
  }) {
    const patient = await this.options.repos.getPatient(input.appointment.patientId);
    if (!patient) {
      input.summary.blocked += 1;
      await this.auditBlocked({
        clinicId: input.appointment.clinicId,
        appointmentId: input.appointment.id,
        reason: "missing_patient"
      });
      return;
    }

    const conversations = await this.options.repos.listConversationsByPatient({
      clinicId: input.appointment.clinicId,
      patientId: input.appointment.patientId
    });
    const key = reminderDeliveryKey(input.appointment.id, input.kind);
    const claim = await this.options.repos.claimOutboundDelivery({
      key,
      clinicId: input.appointment.clinicId,
      automationType: "reminder",
      toWhatsappNumber: patient.whatsappNumber,
      patientId: patient.id,
      conversationId: conversations[0]?.id,
      appointmentId: input.appointment.id,
      templateName: reminderTemplateName(input.kind),
      metadata: {
        kind: input.kind,
        appointmentStartsAt: input.appointment.startsAt.toISOString()
      },
      now: input.now
    });

    if (claim.kind === "existing") {
      input.summary.skipped += 1;
      return;
    }

    const blockReason = await this.reminderBlockReason({
      appointment: input.appointment,
      profile: input.profile,
      patient,
      now: input.now
    });
    if (blockReason) {
      input.summary.blocked += 1;
      await this.blockDelivery({ delivery: claim.delivery, reason: blockReason, now: input.now });
      return;
    }

    const service = input.profile.services.find((candidate) => candidate.id === input.appointment.serviceId);
    if (!service) {
      input.summary.blocked += 1;
      await this.blockDelivery({ delivery: claim.delivery, reason: "missing_service", now: input.now });
      return;
    }

    try {
      const result = await this.options.templateService.sendApprovedTemplate(
        buildOutboundTemplate({
          clinicId: input.appointment.clinicId,
          to: patient.whatsappNumber,
          kind: reminderTemplateKind(input.kind),
          parameters: {
            clinicName: input.profile.name,
            serviceName: service.name,
            appointmentTimeText: formatAppointmentTime(input.appointment.startsAt, input.profile.timezone)
          }
        })
      );

      if (result.status === "blocked_opt_out") {
        input.summary.blocked += 1;
        await this.blockDelivery({ delivery: claim.delivery, reason: "opt_out", now: input.now });
        return;
      }

      await this.options.repos.markOutboundDeliverySent({
        key: claim.delivery.key,
        providerMessageId: result.providerMessageId,
        sentAt: input.now
      });
      input.summary.sent += 1;
      await this.options.audit.record({
        clinicId: claim.delivery.clinicId,
        conversationId: claim.delivery.conversationId,
        type: "outbound.reminder.sent",
        message: "Sent appointment reminder",
        metadata: {
          key: claim.delivery.key,
          appointmentId: input.appointment.id,
          patientId: patient.id,
          kind: input.kind,
          providerMessageId: result.providerMessageId
        }
      });
    } catch (error) {
      input.summary.failed += 1;
      await this.failDelivery({
        delivery: claim.delivery,
        reason: errorMessage(error),
        now: input.now
      });
    }
  }

  private async sentReminderKinds(appointmentId: string): Promise<Exclude<ReminderKind, "none">[]> {
    const kinds: Exclude<ReminderKind, "none">[] = [];

    for (const kind of ["72h", "24h", "same-day"] as const) {
      const delivery = await this.options.repos.getOutboundDelivery(reminderDeliveryKey(appointmentId, kind));
      if (delivery?.status === "sent") {
        kinds.push(kind);
      }
    }

    return kinds;
  }

  private async reminderBlockReason(input: {
    appointment: Appointment;
    profile: ClinicProfile;
    patient: Patient;
    now: Date;
  }): Promise<ReminderBlockReason | undefined> {
    if (await this.options.repos.isOptedOut(input.patient.whatsappNumber)) {
      return "opt_out";
    }

    if (isInsideQuietHours({ now: input.now, timezone: input.profile.timezone })) {
      return "quiet_hours";
    }

    if (await this.patientHasPausedConversation(input.appointment.clinicId, input.patient.id)) {
      return "handoff_paused";
    }

    const event = await this.options.calendar.getEvent(input.appointment.calendarEventId, input.appointment.calendarId);
    if (!event || event.status === "cancelled") {
      return "calendar_event_cancelled";
    }

    return undefined;
  }

  private async patientHasPausedConversation(clinicId: string, patientId: string): Promise<boolean> {
    const conversations = await this.options.repos.listConversationsByPatient({ clinicId, patientId });
    return conversations.some((conversation) => conversation.botPaused);
  }

  private async requireProfile(clinicId: string): Promise<ClinicProfile> {
    const profile = await this.options.repos.getClinicProfile(clinicId);
    if (!profile) {
      throw new Error(`Clinic ${clinicId} not configured`);
    }
    return profile;
  }

  private async blockDelivery(input: {
    delivery: OutboundDeliveryRecord;
    reason: ReminderBlockReason;
    now: Date;
  }): Promise<void> {
    await this.options.repos.markOutboundDeliveryBlocked({
      key: input.delivery.key,
      reason: input.reason,
      blockedAt: input.now
    });
    await this.auditBlocked({
      clinicId: input.delivery.clinicId,
      conversationId: input.delivery.conversationId,
      appointmentId: input.delivery.appointmentId,
      patientId: input.delivery.patientId,
      key: input.delivery.key,
      reason: input.reason
    });
  }

  private async auditBlocked(input: {
    clinicId: string;
    conversationId?: string;
    appointmentId?: string;
    patientId?: string;
    key?: string;
    reason: ReminderBlockReason;
  }): Promise<void> {
    await this.options.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "outbound.delivery.blocked",
      message: "Blocked outbound delivery",
      metadata: {
        reason: input.reason,
        ...(input.key ? { key: input.key } : {}),
        ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
        ...(input.patientId ? { patientId: input.patientId } : {})
      }
    });
  }

  private async failDelivery(input: {
    delivery: OutboundDeliveryRecord;
    reason: string;
    now: Date;
  }): Promise<void> {
    await this.options.repos.markOutboundDeliveryFailed({
      key: input.delivery.key,
      reason: input.reason,
      failedAt: input.now
    });
    await this.options.audit.record({
      clinicId: input.delivery.clinicId,
      conversationId: input.delivery.conversationId,
      type: "outbound.delivery.failed",
      message: "Failed outbound delivery",
      metadata: {
        key: input.delivery.key,
        reason: input.reason,
        ...(input.delivery.appointmentId ? { appointmentId: input.delivery.appointmentId } : {}),
        ...(input.delivery.patientId ? { patientId: input.delivery.patientId } : {})
      }
    });
  }
}

function emptySummary(): OutboundAutomationSummary {
  return { sent: 0, blocked: 0, failed: 0, skipped: 0 };
}

function reminderDeliveryKey(appointmentId: string, kind: Exclude<ReminderKind, "none">): string {
  return `reminder:${appointmentId}:${kind}`;
}

function reminderTemplateName(kind: Exclude<ReminderKind, "none">): string {
  switch (kind) {
    case "72h":
      return "appointment_reminder_72h";
    case "24h":
      return "appointment_reminder_24h";
    case "same-day":
      return "appointment_reminder_same_day";
  }
}

function reminderTemplateKind(kind: Exclude<ReminderKind, "none">): ReminderTemplateKind {
  switch (kind) {
    case "72h":
      return "reminder_72h";
    case "24h":
      return "reminder_24h";
    case "same-day":
      return "reminder_same_day";
  }
}

function formatAppointmentTime(appointmentTime: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(appointmentTime);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return `${value("weekday")} ${value("day")}/${value("month")} ${value("hour")}:${value("minute")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
