import type { InMemoryRepositories } from "../../adapters/memory/repositories.js";
import { DomainError } from "../../domain/errors.js";
import type { Appointment, ClinicProfile } from "../../domain/types.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import { CalendarAvailabilityError, type CalendarPort, type CalendarSlot } from "../../ports/calendar.js";

type BookAppointmentInput = {
  clinicId: string;
  patientId: string;
  serviceId: string;
  startsAt: Date;
  professionalId: string;
  conversationId?: string;
};

export class SchedulingService {
  constructor(
    private readonly repos: InMemoryRepositories,
    private readonly calendar: CalendarPort,
    private readonly audit: AuditLogPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async findSlots(input: {
    clinicId: string;
    serviceId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<CalendarSlot[]> {
    const profile = this.requireProfile(input.clinicId);
    const service = profile.services.find((candidate) => candidate.id === input.serviceId);
    if (!service) {
      throw new DomainError(`Service ${input.serviceId} not found`);
    }

    const professionals = profile.professionals.filter((professional) => {
      const serviceCompatible = service.professionalIds.includes(professional.id);
      const requested = input.professionalId ? professional.id === input.professionalId : true;
      return serviceCompatible && requested;
    });

    const durationMinutes = service.durationMinutes + profile.appointmentRules.bufferMinutes;
    return this.calendar.findFreeSlots({
      calendarIds: professionals.map((professional) => professional.calendarId),
      from: maxDate(input.from, this.minimumBookableStart(profile)),
      to: input.to,
      durationMinutes,
      availabilityContext: buildAvailabilityContext(profile, professionals, service.durationMinutes)
    });
  }

  async bookAppointment(input: BookAppointmentInput): Promise<Appointment> {
    const profile = this.requireProfile(input.clinicId);
    const service = profile.services.find((candidate) => candidate.id === input.serviceId);
    if (!service) {
      throw new DomainError(`Service ${input.serviceId} not found`);
    }

    const professional = profile.professionals.find((candidate) => candidate.id === input.professionalId);
    if (!professional || !service.professionalIds.includes(professional.id)) {
      throw new DomainError(`Professional ${input.professionalId} cannot perform service ${input.serviceId}`);
    }

    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
    const calendarEndsAt = addMinutes(endsAt, profile.appointmentRules.bufferMinutes);
    if (startsAt < this.minimumBookableStart(profile)) {
      throw new DomainError("Selected slot is no longer available");
    }
    const slots = await this.calendar.findFreeSlots({
      calendarIds: [professional.calendarId],
      from: startsAt,
      to: calendarEndsAt,
      durationMinutes: service.durationMinutes + profile.appointmentRules.bufferMinutes,
      availabilityContext: buildAvailabilityContext(profile, [professional], service.durationMinutes)
    });
    const exactSlot = findContainingSlot(slots, startsAt, calendarEndsAt);
    if (!exactSlot) {
      throw new DomainError("Selected slot is no longer available");
    }

    const appointmentId = this.repos.nextAppointmentId();
    const event = await this.createCalendarEvent({
      calendarId: professional.calendarId,
      summary: `${service.name} - ${input.patientId}`,
      startsAt,
      endsAt: calendarEndsAt,
      metadata: { appointmentId, patientId: input.patientId, serviceId: input.serviceId }
    }, "Selected slot is no longer available");

    const appointment: Appointment = {
      id: appointmentId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      serviceId: input.serviceId,
      professionalId: professional.id,
      calendarEventId: event.id,
      startsAt,
      endsAt,
      status: "scheduled"
    };

    this.repos.saveAppointment(appointment);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "appointment.created",
      message: "Created appointment",
      metadata: { appointmentId: appointment.id, calendarEventId: event.id }
    });

    return appointment;
  }

  async cancelAppointment(input: { clinicId: string; appointmentId: string; conversationId?: string }) {
    return this.repos.withAppointmentLock(input.appointmentId, async () => {
      const appointment = this.repos.getAppointment(input.appointmentId);
      if (!appointment) {
        throw new DomainError(`Appointment ${input.appointmentId} not found`);
      }
      this.assertClinicOwnership(appointment, input.clinicId);
      const profile = this.requireProfile(input.clinicId);
      const cancellationNoticeMs = profile.appointmentRules.cancellationNoticeMinutes * 60000;
      if (appointment.startsAt.getTime() - this.now().getTime() < cancellationNoticeMs) {
        throw new DomainError(`Appointment ${appointment.id} cannot be cancelled inside the notice window`);
      }

      await this.calendar.cancelEvent(appointment.calendarEventId);
      const cancelled: Appointment = { ...appointment, status: "cancelled" };
      this.repos.saveAppointment(cancelled);
      await this.audit.record({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        type: "appointment.cancelled",
        message: "Cancelled appointment",
        metadata: { appointmentId: appointment.id }
      });
      return cancelled;
    });
  }

  async rescheduleAppointment(input: {
    clinicId: string;
    appointmentId: string;
    startsAt: Date;
    conversationId?: string;
  }): Promise<Appointment> {
    return this.repos.withAppointmentLock(input.appointmentId, async () => {
      const appointment = this.repos.getAppointment(input.appointmentId);
      if (!appointment) {
        throw new DomainError(`Appointment ${input.appointmentId} not found`);
      }
      this.assertClinicOwnership(appointment, input.clinicId);
      if (appointment.status === "cancelled") {
        throw new DomainError(`Appointment ${appointment.id} is cancelled`);
      }

      const profile = this.requireProfile(input.clinicId);
      const service = profile.services.find((candidate) => candidate.id === appointment.serviceId);
      const professional = profile.professionals.find((candidate) => candidate.id === appointment.professionalId);
      if (!service || !professional) {
        throw new DomainError(`Appointment ${appointment.id} references missing service or professional`);
      }
      const rescheduleNoticeMs = profile.appointmentRules.cancellationNoticeMinutes * 60000;
      if (appointment.startsAt.getTime() - this.now().getTime() < rescheduleNoticeMs) {
        throw new DomainError(`Appointment ${appointment.id} cannot be rescheduled inside the notice window`);
      }

      const startsAt = input.startsAt;
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
      const calendarEndsAt = addMinutes(endsAt, profile.appointmentRules.bufferMinutes);
      if (startsAt < this.minimumBookableStart(profile)) {
        throw new DomainError("Selected reschedule slot is no longer available");
      }
      const slots = await this.calendar.findFreeSlots({
        calendarIds: [professional.calendarId],
        from: startsAt,
        to: calendarEndsAt,
        durationMinutes: service.durationMinutes + profile.appointmentRules.bufferMinutes,
        availabilityContext: buildAvailabilityContext(profile, [professional], service.durationMinutes),
        ignoredEventId: appointment.calendarEventId
      });
      const exactSlot = findContainingSlot(slots, startsAt, calendarEndsAt);
      if (!exactSlot) {
        throw new DomainError("Selected reschedule slot is no longer available");
      }

      await this.updateCalendarEvent(appointment.calendarEventId, {
        calendarId: professional.calendarId,
        summary: `${service.name} - ${appointment.patientId}`,
        startsAt,
        endsAt: calendarEndsAt,
        metadata: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          serviceId: appointment.serviceId
        }
      }, "Selected reschedule slot is no longer available");

      const updated: Appointment = { ...appointment, startsAt, endsAt };
      this.repos.saveAppointment(updated);
      await this.audit.record({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        type: "appointment.rescheduled",
        message: "Rescheduled appointment",
        metadata: { appointmentId: appointment.id }
      });

      return updated;
    });
  }

  private requireProfile(clinicId: string) {
    const profile = this.repos.getClinicProfile(clinicId);
    if (!profile) {
      throw new DomainError(`Clinic ${clinicId} not configured`);
    }
    return profile;
  }

  private assertClinicOwnership(appointment: Appointment, clinicId: string) {
    if (appointment.clinicId !== clinicId) {
      throw new DomainError(`Appointment ${appointment.id} not found`);
    }
  }

  private minimumBookableStart(profile: ClinicProfile) {
    return addMinutes(this.now(), profile.appointmentRules.minimumNoticeMinutes);
  }

  private async createCalendarEvent(
    input: Parameters<CalendarPort["createEvent"]>[0],
    unavailableMessage: string
  ) {
    try {
      return await this.calendar.createEvent(input);
    } catch (error) {
      throw this.toAvailabilityDomainError(error, unavailableMessage);
    }
  }

  private async updateCalendarEvent(
    eventId: string,
    input: Parameters<CalendarPort["updateEvent"]>[1],
    unavailableMessage: string
  ) {
    try {
      return await this.calendar.updateEvent(eventId, input);
    } catch (error) {
      throw this.toAvailabilityDomainError(error, unavailableMessage);
    }
  }

  private toAvailabilityDomainError(error: unknown, unavailableMessage: string): Error {
    if (error instanceof CalendarAvailabilityError) {
      return new DomainError(unavailableMessage);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}

function findContainingSlot(slots: CalendarSlot[], startsAt: Date, endsAt: Date) {
  return slots.find((slot) => slot.startsAt.getTime() <= startsAt.getTime() && slot.endsAt.getTime() >= endsAt.getTime());
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

function maxDate(first: Date, second: Date) {
  return first > second ? first : second;
}

function buildAvailabilityContext(
  profile: ClinicProfile,
  professionals: ClinicProfile["professionals"],
  serviceDurationMinutes: number
) {
  return {
    timezone: profile.timezone,
    professionals: professionals.map((professional) => ({
      id: professional.id,
      calendarId: professional.calendarId,
      workingHours: professional.workingHours
    })),
    serviceDurationMinutes,
    bufferMinutes: profile.appointmentRules.bufferMinutes
  };
}
