import type { Conversation, InMemoryRepositories, PendingBooking } from "../../adapters/memory/repositories.js";
import type { ClinicProfile, Service } from "../../domain/types.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import type { SchedulingService } from "../scheduling/scheduling-service.js";
import { interpretIntent, normalizeText } from "./intent.js";

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
    private readonly repos: InMemoryRepositories,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditLogPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async handleInboundMessage(input: InboundMessage): Promise<WorkflowResult> {
    this.upsertPatient(input);
    const conversation = this.upsertConversation(input);
    if (conversation.botPaused) {
      return { kind: "handoff", text: "Recepcion continua la conversacion por este mismo chat." };
    }

    const intent = interpretIntent(input.text);
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "intent.detected",
      message: `Detected ${intent.type}`,
      metadata: { intent: intent.type }
    });

    if (intent.type === "handoff") {
      const conversation = this.repos.getConversation(input.conversationId);
      if (conversation) {
        this.repos.saveConversation({ ...conversation, botPaused: true, updatedAt: new Date() });
      }
      return { kind: "handoff", text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat." };
    }

    if (intent.type === "book") {
      return this.handleBookingIntent(input, intent.serviceName);
    }

    if (intent.type === "confirm") {
      return this.handleConfirmation(input, conversation);
    }

    if (intent.type === "cancel") {
      this.clearPendingBooking(input.conversationId);
      return {
        kind: "reply",
        text: "Pasame el dia y horario del turno que queres cancelar, asi lo ubico y te confirmo la baja."
      };
    }

    if (intent.type === "reschedule") {
      this.clearPendingBooking(input.conversationId);
      return {
        kind: "reply",
        text: "Pasame el dia y horario del turno que queres cambiar, y si tenes preferencia de nuevo dia."
      };
    }

    return {
      kind: "reply",
      text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno."
    };
  }

  private upsertPatient(input: InboundMessage) {
    const existing = this.repos.getPatient(input.patientId);
    this.repos.upsertPatient({
      ...existing,
      id: input.patientId,
      whatsappNumber: input.whatsappNumber
    });
  }

  private upsertConversation(input: InboundMessage): Conversation {
    const now = new Date();
    const existing = this.repos.getConversation(input.conversationId);
    const conversation = {
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      botPaused: existing?.botPaused ?? false,
      pendingBooking: existing?.pendingBooking,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.repos.saveConversation(conversation);
    return conversation;
  }

  private async handleBookingIntent(input: InboundMessage, serviceName: string): Promise<WorkflowResult> {
    const profile = this.repos.getClinicProfile(input.clinicId);
    if (!profile) {
      return { kind: "reply", text: "No tengo la agenda configurada para esta clinica todavia." };
    }

    const service = findService(profile, serviceName);
    if (!service) {
      this.clearPendingBooking(input.conversationId);
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
      this.clearPendingBooking(input.conversationId);
      return {
        kind: "reply",
        text: `No encontre horarios disponibles para ${service.name} esta semana. Te aviso si se libera un turno o podes decirme otro dia.`
      };
    }

    const first = slots[0];
    const professional = profile.professionals.find((candidate) => candidate.calendarId === first.calendarId);
    if (!professional) {
      this.clearPendingBooking(input.conversationId);
      return {
        kind: "reply",
        text: `No pude identificar el profesional disponible para ${service.name}. Te derivo con recepcion.`
      };
    }

    this.setPendingBooking(input.conversationId, {
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

    try {
      const appointment = await this.scheduling.bookAppointment({
        clinicId: input.clinicId,
        patientId: input.patientId,
        serviceId: pending.serviceId,
        startsAt: pending.startsAt,
        professionalId: pending.professionalId,
        conversationId: input.conversationId
      });
      this.clearPendingBooking(input.conversationId);

      return {
        kind: "reply",
        text: `Turno confirmado para ${appointment.startsAt.toISOString()}. Te vamos a enviar el recordatorio antes del turno.`
      };
    } catch {
      this.clearPendingBooking(input.conversationId);
      return {
        kind: "reply",
        text: "Ese horario ya no esta disponible. Te busco otro horario si queres."
      };
    }
  }

  private setPendingBooking(conversationId: string, pendingBooking: PendingBooking) {
    const conversation = this.repos.getConversation(conversationId);
    if (conversation) {
      this.repos.saveConversation({ ...conversation, pendingBooking, updatedAt: this.now() });
    }
  }

  private clearPendingBooking(conversationId: string) {
    const conversation = this.repos.getConversation(conversationId);
    if (conversation) {
      const { pendingBooking: _pendingBooking, ...nextConversation } = conversation;
      this.repos.saveConversation({ ...nextConversation, updatedAt: this.now() });
    }
  }
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
