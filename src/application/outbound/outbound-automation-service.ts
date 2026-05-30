import type { AuditLogPort } from "../../ports/audit-log.js";
import type { CalendarPort } from "../../ports/calendar.js";
import type { Conversation, OperationalRepository, OutboundDeliveryRecord } from "../../ports/repositories.js";
import type { Appointment, ClinicProfile, Patient } from "../../domain/types.js";
import { OutboundTemplateService } from "../messaging/outbound-template-service.js";
import { isInsideQuietHours } from "./quiet-hours.js";
import { canReactivate } from "./reactivation-policy.js";
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
type ReactivationBlockReason = "missing_patient" | "missing_service" | "opt_out" | "handoff_paused" | "future_appointment";
type OutboundBlockReason = ReminderBlockReason | ReactivationBlockReason;
type ReactivationTemplateKind = "reactivation_1" | "reactivation_2";

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

  async runDueReactivations(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    const profile = await this.requireProfile(input.clinicId);
    const summary = emptySummary();
    const conversations = await this.options.repos.listConversationsByClinic(input.clinicId);

    for (const conversation of conversations) {
      if (!conversation.pendingBooking) {
        continue;
      }

      const attempt = await this.nextReactivationAttempt(conversation, input.now);
      if (!attempt) {
        continue;
      }

      await this.processReactivation({
        conversation,
        profile,
        attempt,
        now: input.now,
        summary
      });
    }

    return summary;
  }

  private async processReactivation(input: {
    conversation: Conversation;
    profile: ClinicProfile;
    attempt: 1 | 2;
    now: Date;
    summary: OutboundAutomationSummary;
  }) {
    const pendingBooking = input.conversation.pendingBooking;
    if (!pendingBooking) {
      return;
    }

    const patient = await this.options.repos.getPatient(input.conversation.patientId);
    const service = input.profile.services.find((candidate) => candidate.id === pendingBooking.serviceId);
    const claim = await this.options.repos.claimOutboundDelivery({
      key: reactivationDeliveryKey(input.conversation.id, input.attempt),
      clinicId: input.conversation.clinicId,
      automationType: "reactivation",
      toWhatsappNumber: patient?.whatsappNumber ?? "",
      patientId: input.conversation.patientId,
      conversationId: input.conversation.id,
      templateName: reactivationTemplateName(input.attempt),
      metadata: {
        attempt: String(input.attempt),
        serviceId: pendingBooking.serviceId
      },
      now: input.now
    });

    if (claim.kind === "existing") {
      input.summary.skipped += 1;
      return;
    }

    try {
      if (!patient) {
        input.summary.blocked += 1;
        await this.blockDelivery({ delivery: claim.delivery, reason: "missing_patient", now: input.now });
        return;
      }

      const blockReason = await this.reactivationBlockReason({
        conversation: input.conversation,
        patient,
        now: input.now
      });
      if (blockReason) {
        input.summary.blocked += 1;
        await this.blockDelivery({ delivery: claim.delivery, reason: blockReason, now: input.now });
        return;
      }

      if (!service) {
        input.summary.blocked += 1;
        await this.blockDelivery({ delivery: claim.delivery, reason: "missing_service", now: input.now });
        return;
      }

      const result = await this.options.templateService.sendApprovedTemplate(
        buildOutboundTemplate({
          clinicId: input.conversation.clinicId,
          to: patient.whatsappNumber,
          kind: reactivationTemplateKind(input.attempt),
          parameters: {
            clinicName: input.profile.name,
            serviceName: service.name
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
        type: "outbound.reactivation.sent",
        message: "Sent warm lead reactivation",
        metadata: {
          key: claim.delivery.key,
          patientId: patient.id,
          attempt: String(input.attempt),
          serviceId: pendingBooking.serviceId,
          providerMessageId: result.providerMessageId
        }
      });
    } catch (error) {
      await this.handleClaimedDeliveryError({
        delivery: claim.delivery,
        reason: errorMessage(error),
        now: input.now,
        summary: input.summary
      });
    }
  }

  private async processReminder(input: {
    appointment: Appointment;
    profile: ClinicProfile;
    kind: Exclude<ReminderKind, "none">;
    now: Date;
    summary: OutboundAutomationSummary;
  }) {
    const key = reminderDeliveryKey(input.appointment.id, input.kind);
    const patient = await this.options.repos.getPatient(input.appointment.patientId);
    const conversations = patient
      ? await this.options.repos.listConversationsByPatient({
          clinicId: input.appointment.clinicId,
          patientId: input.appointment.patientId
        })
      : [];

    const patientOptedOut = patient ? await this.options.repos.isOptedOut(patient.whatsappNumber) : false;
    if (
      patient &&
      !patientOptedOut &&
      isInsideQuietHours({ now: input.now, timezone: input.profile.timezone })
    ) {
      input.summary.blocked += 1;
      await this.auditQuietHoursBlock({
        appointment: input.appointment,
        patient,
        conversationId: conversations[0]?.id
      });
      return;
    }

    const claim = await this.options.repos.claimOutboundDelivery({
      key,
      clinicId: input.appointment.clinicId,
      automationType: "reminder",
      toWhatsappNumber: patient?.whatsappNumber ?? "",
      patientId: input.appointment.patientId,
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

    try {
      if (!patient) {
        input.summary.blocked += 1;
        await this.blockDelivery({ delivery: claim.delivery, reason: "missing_patient", now: input.now });
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
      await this.handleClaimedDeliveryError({
        delivery: claim.delivery,
        reason: errorMessage(error),
        now: input.now,
        summary: input.summary
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

    if (await this.patientHasPausedConversation(input.appointment.clinicId, input.patient.id)) {
      return "handoff_paused";
    }

    const event = await this.options.calendar.getEvent(input.appointment.calendarEventId, input.appointment.calendarId);
    if (!event || event.status === "cancelled") {
      return "calendar_event_cancelled";
    }

    return undefined;
  }

  private async reactivationBlockReason(input: {
    conversation: Conversation;
    patient: Patient;
    now: Date;
  }): Promise<ReactivationBlockReason | undefined> {
    if (await this.options.repos.isOptedOut(input.patient.whatsappNumber)) {
      return "opt_out";
    }

    if (input.conversation.botPaused) {
      return "handoff_paused";
    }

    const appointments = await this.options.repos.listAppointmentsByPatient(input.patient.id);
    if (
      appointments.some(
        (appointment) => appointment.status === "scheduled" && appointment.startsAt.getTime() > input.now.getTime()
      )
    ) {
      return "future_appointment";
    }

    return undefined;
  }

  private async nextReactivationAttempt(conversation: Conversation, now: Date): Promise<1 | 2 | undefined> {
    const first = await this.options.repos.getOutboundDelivery(reactivationDeliveryKey(conversation.id, 1));

    if (first?.status !== "sent") {
      return canReactivate({
        hadPriorConversation: true,
        optedOut: false,
        previousAttempts: 0,
        now,
        lastAttemptAt: conversation.updatedAt
      })
        ? 1
        : undefined;
    }

    const second = await this.options.repos.getOutboundDelivery(reactivationDeliveryKey(conversation.id, 2));
    if (second?.status === "sent") {
      return undefined;
    }

    if (conversation.updatedAt.getTime() > first.sentAt!.getTime()) {
      return undefined;
    }

    return canReactivate({
      hadPriorConversation: true,
      optedOut: false,
      previousAttempts: 1,
      now,
      lastAttemptAt: first.sentAt
    })
      ? 2
      : undefined;
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
    reason: OutboundBlockReason;
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
    reason: OutboundBlockReason;
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

  private async auditQuietHoursBlock(input: {
    appointment: Appointment;
    patient: Patient;
    conversationId?: string;
  }): Promise<void> {
    try {
      await this.auditBlocked({
        clinicId: input.appointment.clinicId,
        conversationId: input.conversationId,
        appointmentId: input.appointment.id,
        patientId: input.patient.id,
        reason: "quiet_hours"
      });
    } catch {
      // Quiet-hours blocks are temporary and must not consume the delivery key.
    }
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

  private async handleClaimedDeliveryError(input: {
    delivery: OutboundDeliveryRecord;
    reason: string;
    now: Date;
    summary: OutboundAutomationSummary;
  }): Promise<void> {
    const currentDelivery = await this.options.repos.getOutboundDelivery(input.delivery.key);
    if (currentDelivery?.status !== "claimed") {
      return;
    }

    input.summary.failed += 1;
    await this.failDelivery({
      delivery: input.delivery,
      reason: input.reason,
      now: input.now
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

function reactivationDeliveryKey(conversationId: string, attempt: 1 | 2): string {
  return `reactivation:${conversationId}:${attempt}`;
}

function reactivationTemplateName(attempt: 1 | 2): string {
  return attempt === 1 ? "lead_reactivation_1" : "lead_reactivation_2";
}

function reactivationTemplateKind(attempt: 1 | 2): ReactivationTemplateKind {
  return attempt === 1 ? "reactivation_1" : "reactivation_2";
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
