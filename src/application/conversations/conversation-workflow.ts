import type { Appointment, ClinicProfile, Service } from "../../domain/types.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import { CalendarInfrastructureError } from "../../ports/calendar.js";
import type { Conversation, OperationalRepository, PendingBooking } from "../../ports/repositories.js";
import type { SchedulingService } from "../scheduling/scheduling-service.js";
import type { ConversationInterpreter } from "./interpreter.js";
import { normalizeText } from "./intent.js";
import { RulesConversationInterpreter } from "./rules-interpreter.js";

type InboundMessage = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
};

export type WorkflowResult =
  | { kind: "reply"; text: string }
  | { kind: "handoff"; text: string };

export class ConversationWorkflow {
  constructor(
    private readonly repos: OperationalRepository,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditLogPort,
    private readonly now: () => Date = () => new Date(),
    private readonly interpreter: ConversationInterpreter = new RulesConversationInterpreter()
  ) {}

  async handleInboundMessage(input: InboundMessage): Promise<WorkflowResult> {
    return this.repos.withConversationLock(`${input.clinicId}:${input.conversationId}`, () =>
      this.handleInboundMessageLocked(input)
    );
  }

  private async handleInboundMessageLocked(input: InboundMessage): Promise<WorkflowResult> {
    await this.upsertPatient(input);
    const conversation = await this.upsertConversation(input);
    if (conversation.botPaused) {
      return { kind: "handoff", text: "Recepcion continua la conversacion por este mismo chat." };
    }

    const pendingDataResult = await this.tryCompletePendingPatientData(input, conversation);
    if (pendingDataResult) {
      return pendingDataResult;
    }

    const intent = await this.interpreter.interpret({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      patientId: input.patientId,
      messageText: input.text,
      now: this.now(),
      clinicProfile: await this.repos.getClinicProfile(input.clinicId),
      pendingBooking: conversation.pendingBooking
    });
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "intent.detected",
      message: `Detected ${intent.intent}`,
      metadata: {
        intent: intent.intent,
        provider: intent.provider,
        confidence: String(intent.confidence),
        serviceName: intent.serviceName ?? "",
        requestedTopics: intent.requestedTopics.join(","),
        requiresHuman: String(intent.requiresHuman),
        safetyReason: intent.safetyReason ?? ""
      }
    });

    if (intent.intent === "handoff") {
      const conversation = await this.repos.getConversation({
        clinicId: input.clinicId,
        conversationId: input.conversationId
      });
      if (conversation) {
        await this.repos.saveConversation({ ...conversation, botPaused: true, updatedAt: new Date() });
      }
      return { kind: "handoff", text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat." };
    }

    if (intent.intent === "book") {
      return await this.handleBookingIntent(input, intent.serviceName ?? "");
    }

    if (intent.intent === "confirm") {
      return await this.handleConfirmation(input, conversation);
    }

    if (intent.intent === "cancel") {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return await this.handleCancelIntent(input);
    }

    if (intent.intent === "reschedule") {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return await this.handleRescheduleIntent(input);
    }

    return {
      kind: "reply",
      text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno."
    };
  }

  private async upsertPatient(input: InboundMessage) {
    const existing = await this.repos.getPatient(input.patientId);
    await this.repos.upsertPatient({
      ...existing,
      id: input.patientId,
      whatsappNumber: input.whatsappNumber
    });
  }

  private async upsertConversation(input: InboundMessage): Promise<Conversation> {
    const now = new Date();
    const existing = await this.repos.getConversation({
      clinicId: input.clinicId,
      conversationId: input.conversationId
    });
    const conversation = {
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      botPaused: existing?.botPaused ?? false,
      pendingBooking: existing?.pendingBooking,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.repos.saveConversation(conversation);
    return conversation;
  }

  private async handleBookingIntent(input: InboundMessage, serviceName: string): Promise<WorkflowResult> {
    const profile = await this.repos.getClinicProfile(input.clinicId);
    if (!profile) {
      return { kind: "reply", text: "No tengo la agenda configurada para esta clinica todavia." };
    }

    const service = findService(profile, serviceName);
    if (!service) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: serviceName
          ? `No encontre ese tratamiento. Por ahora puedo ayudarte con: ${formatServiceList(profile)}.`
          : `Decime que tratamiento queres reservar. Por ahora puedo ayudarte con: ${formatServiceList(profile)}.`
      };
    }

    const searchFrom = startOfDay(this.now());
    const slots = await this.scheduling.findSlots({
      clinicId: input.clinicId,
      serviceId: service.id,
      from: searchFrom,
      to: addDays(searchFrom, 14)
    });

    if (slots.length === 0) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: `No encontre horarios disponibles para ${service.name} esta semana. Te aviso si se libera un turno o podes decirme otro dia.`
      };
    }

    const first = slots[0];
    const professional = profile.professionals.find((candidate) => candidate.calendarId === first.calendarId);
    if (!professional) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: `No pude identificar el profesional disponible para ${service.name}. Te derivo con recepcion.`
      };
    }

    await this.setPendingBooking(input.clinicId, input.conversationId, {
      serviceId: service.id,
      professionalId: professional.id,
      startsAt: first.startsAt,
      endsAt: first.endsAt
    });

    return {
      kind: "reply",
      text: `Tengo este horario: ${first.startsAt.toISOString()} con disponibilidad para ${service.name}. Si te sirve, lo confirmamos.`
    };
  }

  private async handleConfirmation(input: InboundMessage, conversation: Conversation): Promise<WorkflowResult> {
    const pending = conversation.pendingBooking;
    if (!pending) {
      return { kind: "reply", text: "Decime que tratamiento queres reservar y te paso horarios disponibles." };
    }

    if (
      !pending.appointmentId &&
      (await this.missingRequiredPatientFields(input.clinicId, input.patientId)).includes("fullName")
    ) {
      return { kind: "reply", text: "Perfecto. Para confirmar el turno, pasame nombre y apellido." };
    }

    try {
      const appointment = pending.appointmentId
        ? await this.scheduling.rescheduleAppointment({
            clinicId: input.clinicId,
            appointmentId: pending.appointmentId,
            startsAt: pending.startsAt,
            conversationId: input.conversationId
          })
        : await this.scheduling.bookAppointment({
            clinicId: input.clinicId,
            patientId: input.patientId,
            serviceId: pending.serviceId,
            startsAt: pending.startsAt,
            professionalId: pending.professionalId,
            conversationId: input.conversationId
          });
      await this.clearPendingBooking(input.clinicId, input.conversationId);

      return {
        kind: "reply",
        text: pending.appointmentId
          ? `Turno reprogramado para ${appointment.startsAt.toISOString()}. Te vamos a enviar el recordatorio antes del turno.`
          : `Turno confirmado para ${appointment.startsAt.toISOString()}. Te vamos a enviar el recordatorio antes del turno.`
      };
    } catch (error) {
      if (error instanceof CalendarInfrastructureError) {
        throw error;
      }
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: "Ese horario ya no esta disponible. Te busco otro horario si queres."
      };
    }
  }

  private async setPendingBooking(clinicId: string, conversationId: string, pendingBooking: PendingBooking) {
    const conversation = await this.repos.getConversation({ clinicId, conversationId });
    if (conversation) {
      await this.repos.saveConversation({ ...conversation, pendingBooking, updatedAt: this.now() });
    }
  }

  private async clearPendingBooking(clinicId: string, conversationId: string) {
    const conversation = await this.repos.getConversation({ clinicId, conversationId });
    if (conversation) {
      const { pendingBooking: _pendingBooking, ...nextConversation } = conversation;
      await this.repos.saveConversation({ ...nextConversation, updatedAt: this.now() });
    }
  }

  private async tryCompletePendingPatientData(input: InboundMessage, conversation: Conversation) {
    if (!conversation.pendingBooking || conversation.pendingBooking.appointmentId) {
      return undefined;
    }

    if (!(await this.missingRequiredPatientFields(input.clinicId, input.patientId)).includes("fullName")) {
      return undefined;
    }

    if (!looksLikeFullName(input.text)) {
      return undefined;
    }

    const patient = await this.repos.getPatient(input.patientId);
    await this.repos.upsertPatient({
      id: input.patientId,
      whatsappNumber: input.whatsappNumber,
      fullName: normalizeFullName(input.text) ?? patient?.fullName
    });

    return await this.handleConfirmation(input, conversation);
  }

  private async missingRequiredPatientFields(clinicId: string, patientId: string) {
    const profile = await this.repos.getClinicProfile(clinicId);
    const patient = await this.repos.getPatient(patientId);
    if (!profile) {
      return [];
    }

    return profile.requiredPatientFields.filter((field) => field === "fullName" && !patient?.fullName);
  }

  private async handleCancelIntent(input: InboundMessage): Promise<WorkflowResult> {
    const appointment = await this.findSingleScheduledAppointment(input);
    if (!appointment) {
      return {
        kind: "reply",
        text: "No encontre un unico turno activo para cancelar. Pasame dia y horario y lo reviso."
      };
    }

    try {
      const cancelled = await this.scheduling.cancelAppointment({
        clinicId: input.clinicId,
        appointmentId: appointment.id,
        conversationId: input.conversationId
      });

      return { kind: "reply", text: `Turno cancelado: ${cancelled.startsAt.toISOString()}.` };
    } catch (error) {
      if (error instanceof CalendarInfrastructureError) {
        throw error;
      }
      return { kind: "reply", text: "No pude cancelar ese turno automaticamente. Te derivo con recepcion." };
    }
  }

  private async handleRescheduleIntent(input: InboundMessage): Promise<WorkflowResult> {
    const appointment = await this.findSingleScheduledAppointment(input);
    if (!appointment) {
      return {
        kind: "reply",
        text: "No encontre un unico turno activo para reprogramar. Pasame dia y horario y lo reviso."
      };
    }

    const profile = await this.repos.getClinicProfile(input.clinicId);
    const service = profile?.services.find((candidate) => candidate.id === appointment.serviceId);
    if (!profile || !service) {
      return { kind: "reply", text: "No pude encontrar el servicio del turno. Te derivo con recepcion." };
    }

    const searchFrom = startOfDay(this.now());
    const slots = await this.scheduling.findSlots({
      clinicId: input.clinicId,
      serviceId: service.id,
      professionalId: appointment.professionalId,
      from: searchFrom,
      to: addDays(searchFrom, 14)
    });
    const nextSlot = slots.find((slot) => slot.startsAt.getTime() !== appointment.startsAt.getTime());
    if (!nextSlot) {
      return { kind: "reply", text: "No encontre otro horario disponible para reprogramar. Te aviso si se libera uno." };
    }

    await this.setPendingBooking(input.clinicId, input.conversationId, {
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      professionalId: appointment.professionalId,
      startsAt: nextSlot.startsAt,
      endsAt: nextSlot.endsAt
    });

    return {
      kind: "reply",
      text: `Tengo este nuevo horario: ${nextSlot.startsAt.toISOString()}. Si te sirve, lo confirmamos.`
    };
  }

  private async findSingleScheduledAppointment(input: InboundMessage): Promise<Appointment | undefined> {
    const scheduled = (await this.repos.listAppointmentsByPatient(input.patientId)).filter(
      (appointment) => appointment.clinicId === input.clinicId && appointment.status === "scheduled"
    );
    return scheduled.length === 1 ? scheduled[0] : undefined;
  }
}

function looksLikeFullName(text: string) {
  const normalized = normalizeFullName(text);
  return normalized ? normalized.split(" ").length >= 2 : false;
}

function normalizeFullName(text: string) {
  const normalized = text.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 5 ? normalized : undefined;
}

function findService(profile: ClinicProfile, serviceName: string): Service | undefined {
  const normalizedServiceName = normalizeText(serviceName);
  if (!normalizedServiceName) {
    return undefined;
  }

  return profile.services.find((service) => {
    const normalizedCandidate = normalizeText(service.name);
    return (
      normalizedCandidate === normalizedServiceName ||
      normalizedCandidate.includes(normalizedServiceName) ||
      normalizedServiceName.includes(normalizedCandidate) ||
      matchesKnownAlias(normalizedCandidate, normalizedServiceName)
    );
  });
}

function formatServiceList(profile: ClinicProfile) {
  return profile.services.map((service) => service.name).join(", ");
}

function matchesKnownAlias(normalizedCandidate: string, normalizedServiceName: string) {
  return normalizedCandidate === "botox" && normalizedServiceName.includes("toxina");
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
