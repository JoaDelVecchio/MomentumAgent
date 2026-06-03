import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { parseClinicProfile } from "../../domain/clinic-profile.js";
import { patientFields, type Appointment, type ClinicProfile, type Id, type Patient, type PatientField, type WorkingWindow } from "../../domain/types.js";
import type {
  Conversation,
  ConversationByPatientLookup,
  ConversationLookup,
  ConversationMessage,
  ListScheduledAppointmentsInput,
  OutboundAutomationType,
  OperationalRepository,
  OutboundDeliveryClaim,
  OutboundDeliveryClaimInput,
  OutboundDeliveryRecord,
  OutboundDeliveryStatus,
  PatientInterest,
  PendingBooking,
  ProcessedWebhookDeliveryInput,
  WebhookDeliveryClaim,
  WebhookDeliveryOutcomeInput,
  WebhookDeliveryRecord
} from "../../ports/repositories.js";

type PatientRecord = { id: string; whatsappNumber: string; fullName: string | null };

type ServiceRecord = {
  id: string;
  name: string;
  durationMinutes: number;
  priceText: string;
  preparation: string;
  restrictionsJson: string;
};

type ProfessionalRecord = {
  id: string;
  name: string;
  calendarId: string;
  workingHoursJson: string;
};

type ServiceProfessionalRecord = {
  serviceId: string;
  professionalId: string;
};

type ClinicProfileRecord = {
  id: string;
  name: string;
  timezone: string;
  minimumNoticeMinutes: number;
  cancellationNoticeMinutes: number;
  bufferMinutes: number;
  requiredPatientFieldsJson: string;
  services: ServiceRecord[];
  professionals: ProfessionalRecord[];
  serviceProfessionals: ServiceProfessionalRecord[];
};

type AppointmentRecord = {
  id: string;
  clinicId: string;
  patientId: string;
  serviceId: string;
  professionalId: string;
  calendarEventId: string;
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

type ConversationRecord = {
  id: string;
  clinicId: string;
  patientId: string;
  botPaused: boolean;
  pendingBookingJson: string | null;
  recentMessagesJson: string;
  createdAt: Date;
  updatedAt: Date;
};

type WebhookDeliveryPrismaRecord = {
  provider: string;
  idempotencyKey: string;
  clinicId: string;
  conversationId: string | null;
  providerMessageId: string | null;
  outboundProviderMessageId: string | null;
  status: string;
  responseText: string | null;
  workflowResult: string | null;
};

type OutboundDeliveryPrismaRecord = {
  id: string;
  clinicId: string;
  deliveryKey: string;
  automationType: string;
  status: string;
  toWhatsappNumber: string;
  patientId: string | null;
  conversationId: string | null;
  appointmentId: string | null;
  templateName: string;
  metadataJson: string;
  providerMessageId: string | null;
  failureReason: string | null;
  claimedAt: Date;
  sentAt: Date | null;
  blockedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PatientInterestRecord = {
  id: string;
  clinicId: string;
  patientId: string;
  serviceId: string;
  professionalId: string | null;
  preferredFrom: Date;
  preferredTo: Date;
  status: string;
};

export class PrismaOperationalRepository implements OperationalRepository {
  private clinicProfiles = new Map<string, ClinicProfile>();
  private appointmentLocks = new Map<Id, Promise<unknown>>();
  private conversationLocks = new Map<Id, Promise<unknown>>();
  private webhookDeliveryLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaClient) {}

  async upsertClinicProfile(profile: ClinicProfile): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.upsert({
        where: { id: profile.clinicId },
        create: {
          id: profile.clinicId,
          name: profile.name,
          timezone: profile.timezone,
          minimumNoticeMinutes: profile.appointmentRules.minimumNoticeMinutes,
          cancellationNoticeMinutes: profile.appointmentRules.cancellationNoticeMinutes,
          bufferMinutes: profile.appointmentRules.bufferMinutes,
          requiredPatientFieldsJson: JSON.stringify(profile.requiredPatientFields)
        },
        update: {
          name: profile.name,
          timezone: profile.timezone,
          minimumNoticeMinutes: profile.appointmentRules.minimumNoticeMinutes,
          cancellationNoticeMinutes: profile.appointmentRules.cancellationNoticeMinutes,
          bufferMinutes: profile.appointmentRules.bufferMinutes,
          requiredPatientFieldsJson: JSON.stringify(profile.requiredPatientFields)
        }
      });

      for (const service of profile.services) {
        await tx.service.upsert({
          where: { clinicId_id: { clinicId: profile.clinicId, id: service.id } },
          create: {
            id: service.id,
            clinicId: profile.clinicId,
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceText: service.priceText,
            preparation: service.preparation,
            restrictionsJson: JSON.stringify(service.restrictions)
          },
          update: {
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceText: service.priceText,
            preparation: service.preparation,
            restrictionsJson: JSON.stringify(service.restrictions)
          }
        });
      }

      for (const professional of profile.professionals) {
        await tx.professional.upsert({
          where: { clinicId_id: { clinicId: profile.clinicId, id: professional.id } },
          create: {
            id: professional.id,
            clinicId: profile.clinicId,
            name: professional.name,
            calendarId: professional.calendarId,
            workingHoursJson: JSON.stringify(professional.workingHours)
          },
          update: {
            name: professional.name,
            calendarId: professional.calendarId,
            workingHoursJson: JSON.stringify(professional.workingHours)
          }
        });
      }

      await syncServiceProfessionalLinks(tx, profile);
      await pruneStaleProfileRows(tx, profile);
    });

    this.clinicProfiles.set(profile.clinicId, cloneClinicProfile(profile));
  }

  async getClinicProfile(clinicId: Id): Promise<ClinicProfile | undefined> {
    const profile = this.clinicProfiles.get(clinicId);
    if (profile) {
      return cloneClinicProfile(profile);
    }

    const persisted = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      include: {
        services: { orderBy: { id: "asc" } },
        professionals: { orderBy: { id: "asc" } },
        serviceProfessionals: { orderBy: [{ serviceId: "asc" }, { professionalId: "asc" }] }
      }
    });
    if (!persisted) {
      return undefined;
    }

    const hydrated = toClinicProfile(persisted);
    if (!hydrated) {
      return undefined;
    }
    this.clinicProfiles.set(clinicId, cloneClinicProfile(hydrated));
    return cloneClinicProfile(hydrated);
  }

  async upsertPatient(patient: Patient): Promise<void> {
    await this.prisma.patient.upsert({
      where: { id: patient.id },
      create: {
        id: patient.id,
        whatsappNumber: patient.whatsappNumber,
        fullName: patient.fullName
      },
      update: {
        whatsappNumber: patient.whatsappNumber,
        fullName: patient.fullName
      }
    });
  }

  async getPatient(patientId: Id): Promise<Patient | undefined> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    return patient ? toPatient(patient) : undefined;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.prisma.conversation.upsert({
      where: { clinicId_id: { clinicId: conversation.clinicId, id: conversation.id } },
      create: {
        id: conversation.id,
        clinicId: conversation.clinicId,
        patientId: conversation.patientId,
        botPaused: conversation.botPaused,
        pendingBookingJson: serializePendingBooking(conversation.pendingBooking),
        recentMessagesJson: serializeConversationMessages(conversation.recentMessages ?? []),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      },
      update: {
        clinicId: conversation.clinicId,
        patientId: conversation.patientId,
        botPaused: conversation.botPaused,
        pendingBookingJson: serializePendingBooking(conversation.pendingBooking),
        recentMessagesJson: serializeConversationMessages(conversation.recentMessages ?? []),
        updatedAt: conversation.updatedAt
      }
    });
  }

  async getConversation(lookup: ConversationLookup): Promise<Conversation | undefined> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { clinicId_id: { clinicId: lookup.clinicId, id: lookup.conversationId } }
    });
    return conversation ? toConversation(conversation) : undefined;
  }

  async saveAppointment(appointment: Appointment): Promise<void> {
    await this.prisma.appointment.upsert({
      where: { id: appointment.id },
      create: {
        id: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        serviceId: appointment.serviceId,
        professionalId: appointment.professionalId,
        calendarEventId: appointment.calendarEventId,
        calendarId: appointment.calendarId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status
      },
      update: {
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        serviceId: appointment.serviceId,
        professionalId: appointment.professionalId,
        calendarEventId: appointment.calendarEventId,
        calendarId: appointment.calendarId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status
      }
    });
  }

  async nextAppointmentId(): Promise<Id> {
    return `appt_${randomUUID()}`;
  }

  async withAppointmentLock<T>(appointmentId: Id, operation: () => Promise<T>): Promise<T> {
    return withKeyedLock(this.appointmentLocks, appointmentId, operation);
  }

  async withConversationLock<T>(conversationId: Id, operation: () => Promise<T>): Promise<T> {
    return withKeyedLock(this.conversationLocks, conversationId, operation);
  }

  async withWebhookDeliveryLock<T>(idempotencyKey: string, operation: () => Promise<T>): Promise<T> {
    return withKeyedLock(this.webhookDeliveryLocks, idempotencyKey, operation);
  }

  async getAppointment(appointmentId: Id): Promise<Appointment | undefined> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId }
    });
    return appointment ? toAppointment(appointment) : undefined;
  }

  async listAppointmentsByPatient(patientId: Id): Promise<Appointment[]> {
    const appointments = await this.prisma.appointment.findMany({
      where: { patientId },
      orderBy: { startsAt: "asc" }
    });
    return appointments.map(toAppointment);
  }

  async listScheduledAppointments(input: ListScheduledAppointmentsInput): Promise<Appointment[]> {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId: input.clinicId,
        status: "scheduled",
        startsAt: { gte: input.from, lte: input.to }
      },
      orderBy: { startsAt: "asc" }
    });
    return appointments.map(toAppointment);
  }

  async listConversationsByClinic(clinicId: Id): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { clinicId },
      orderBy: { updatedAt: "asc" }
    });
    return conversations.map(toConversation);
  }

  async listConversationsByPatient(lookup: ConversationByPatientLookup): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { clinicId: lookup.clinicId, patientId: lookup.patientId },
      orderBy: { updatedAt: "desc" }
    });
    return conversations.map(toConversation);
  }

  async saveInterest(interest: PatientInterest): Promise<void> {
    await this.prisma.patientInterest.upsert({
      where: { id: interest.id },
      create: {
        id: interest.id,
        clinicId: interest.clinicId,
        patientId: interest.patientId,
        serviceId: interest.serviceId,
        professionalId: interest.professionalId,
        preferredFrom: interest.preferredFrom,
        preferredTo: interest.preferredTo,
        status: interest.status
      },
      update: {
        clinicId: interest.clinicId,
        patientId: interest.patientId,
        serviceId: interest.serviceId,
        professionalId: interest.professionalId,
        preferredFrom: interest.preferredFrom,
        preferredTo: interest.preferredTo,
        status: interest.status
      }
    });
  }

  async listActiveInterests(): Promise<PatientInterest[]> {
    const interests = await this.prisma.patientInterest.findMany({
      where: { status: "active" },
      orderBy: { preferredFrom: "asc" }
    });
    return interests.map(toPatientInterest);
  }

  async markOptOut(whatsappNumber: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppOptOut.upsert({
        where: { whatsappNumber },
        create: { whatsappNumber },
        update: {}
      });
      await tx.patient.updateMany({
        where: { whatsappNumber },
        data: { optedOut: true }
      });
    });
  }

  async isOptedOut(whatsappNumber: string): Promise<boolean> {
    const optOut = await this.prisma.whatsAppOptOut.findUnique({ where: { whatsappNumber } });
    if (optOut) {
      return true;
    }
    const patient = await this.prisma.patient.findUnique({
      where: { whatsappNumber },
      select: { optedOut: true }
    });
    return patient?.optedOut ?? false;
  }

  async claimWebhookDelivery(input: ProcessedWebhookDeliveryInput): Promise<WebhookDeliveryClaim> {
    try {
      const delivery = await this.prisma.processedWebhookDelivery.create({
        data: {
          provider: input.provider,
          idempotencyKey: input.idempotencyKey,
          clinicId: input.clinicId,
          conversationId: input.conversationId,
          providerMessageId: input.providerMessageId,
          status: "processing"
        }
      });
      return { kind: "new", delivery: toWebhookDelivery(delivery) };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }
      const delivery = await this.prisma.processedWebhookDelivery.findUnique({
        where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } }
      });
      if (!delivery) {
        throw error;
      }

      if (delivery.status === "response_ready" && delivery.responseText && delivery.workflowResult) {
        const claim = await this.prisma.processedWebhookDelivery.updateMany({
          where: {
            provider: input.provider,
            idempotencyKey: input.idempotencyKey,
            status: "response_ready"
          },
          data: {
            clinicId: input.clinicId,
            conversationId: input.conversationId,
            providerMessageId: input.providerMessageId,
            status: "processing",
            processedAt: new Date()
          }
        });

        if (claim.count === 1) {
          const claimed = await this.prisma.processedWebhookDelivery.findUnique({
            where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } }
          });
          if (claimed) {
            return { kind: "retry", delivery: toWebhookDelivery(claimed) };
          }
        }

        const current = await this.prisma.processedWebhookDelivery.findUnique({
          where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } }
        });
        if (current) {
          return { kind: "existing", delivery: toWebhookDelivery(current) };
        }
      }
      return { kind: "existing", delivery: toWebhookDelivery(delivery) };
    }
  }

  async releaseWebhookDeliveryClaim(input: ProcessedWebhookDeliveryInput): Promise<void> {
    await this.prisma.processedWebhookDelivery.deleteMany({
      where: {
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        status: "processing",
        responseText: null,
        workflowResult: null
      }
    });
  }

  async getWebhookDelivery(idempotencyKey: string): Promise<WebhookDeliveryRecord | undefined> {
    const delivery = await this.prisma.processedWebhookDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: "kapso", idempotencyKey } }
    });
    return delivery ? toWebhookDelivery(delivery) : undefined;
  }

  async saveWebhookDeliveryOutcome(input: WebhookDeliveryOutcomeInput): Promise<void> {
    await this.prisma.processedWebhookDelivery.upsert({
      where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } },
      create: {
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        providerMessageId: input.providerMessageId,
        status: "processing",
        responseText: input.responseText,
        workflowResult: input.workflowResult,
        processedAt: new Date()
      },
      update: {
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        providerMessageId: input.providerMessageId,
        status: "processing",
        responseText: input.responseText,
        workflowResult: input.workflowResult,
        processedAt: new Date()
      }
    });
  }

  async markWebhookDeliveryReadyForRetry(input: ProcessedWebhookDeliveryInput): Promise<void> {
    await this.prisma.processedWebhookDelivery.update({
      where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } },
      data: {
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        providerMessageId: input.providerMessageId,
        status: "response_ready",
        processedAt: new Date()
      }
    });
  }

  async hasProcessedWebhookDelivery(idempotencyKey: string): Promise<boolean> {
    const delivery = await this.prisma.processedWebhookDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: "kapso", idempotencyKey } },
      select: { status: true }
    });
    return delivery?.status === "processed";
  }

  async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): Promise<void> {
    const delivery =
      typeof input === "string"
        ? { provider: "kapso" as const, idempotencyKey: input, clinicId: "clinic_1" }
        : input;

    try {
      await this.prisma.processedWebhookDelivery.upsert({
        where: { provider_idempotencyKey: { provider: delivery.provider, idempotencyKey: delivery.idempotencyKey } },
        create: { ...delivery, status: "processed", processedAt: new Date() },
        update: {
          clinicId: delivery.clinicId,
          conversationId: delivery.conversationId,
          providerMessageId: delivery.providerMessageId,
          outboundProviderMessageId: delivery.outboundProviderMessageId,
          status: "processed",
          processedAt: new Date()
        }
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) return;
      throw error;
    }
  }

  async claimOutboundDelivery(input: OutboundDeliveryClaimInput): Promise<OutboundDeliveryClaim> {
    try {
      const delivery = await this.prisma.outboundDelivery.create({
        data: {
          id: `outbound_${randomUUID()}`,
          clinicId: input.clinicId,
          deliveryKey: input.key,
          automationType: input.automationType,
          status: "claimed",
          toWhatsappNumber: input.toWhatsappNumber,
          patientId: input.patientId,
          conversationId: input.conversationId,
          appointmentId: input.appointmentId,
          templateName: input.templateName,
          metadataJson: JSON.stringify(input.metadata),
          claimedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now
        }
      });
      return { kind: "new", delivery: toOutboundDelivery(delivery) };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }

      const delivery = await this.prisma.outboundDelivery.findUnique({
        where: { deliveryKey: input.key }
      });
      if (!delivery) {
        throw error;
      }
      return { kind: "existing", delivery: toOutboundDelivery(delivery) };
    }
  }

  async getOutboundDelivery(key: string): Promise<OutboundDeliveryRecord | undefined> {
    const delivery = await this.prisma.outboundDelivery.findUnique({
      where: { deliveryKey: key }
    });
    return delivery ? toOutboundDelivery(delivery) : undefined;
  }

  async markOutboundDeliverySent(input: {
    key: string;
    providerMessageId: string;
    sentAt: Date;
  }): Promise<void> {
    await this.updateClaimedOutboundDelivery(input.key, {
      status: "sent",
      providerMessageId: input.providerMessageId,
      sentAt: input.sentAt,
      updatedAt: input.sentAt
    });
  }

  async markOutboundDeliveryBlocked(input: { key: string; reason: string; blockedAt: Date }): Promise<void> {
    await this.updateClaimedOutboundDelivery(input.key, {
      status: "blocked",
      failureReason: input.reason,
      blockedAt: input.blockedAt,
      updatedAt: input.blockedAt
    });
  }

  async markOutboundDeliveryFailed(input: { key: string; reason: string; failedAt: Date }): Promise<void> {
    await this.updateClaimedOutboundDelivery(input.key, {
      status: "failed",
      failureReason: input.reason,
      failedAt: input.failedAt,
      updatedAt: input.failedAt
    });
  }

  private async updateClaimedOutboundDelivery(
    key: string,
    data: Prisma.OutboundDeliveryUpdateManyMutationInput
  ): Promise<void> {
    const update = await this.prisma.outboundDelivery.updateMany({
      where: { deliveryKey: key, status: "claimed" },
      data
    });
    if (update.count === 1) {
      return;
    }

    const delivery = await this.prisma.outboundDelivery.findUnique({
      where: { deliveryKey: key },
      select: { status: true }
    });
    if (!delivery) {
      throw new Error(`Outbound delivery ${key} was not found`);
    }
    throw new Error(`Outbound delivery ${key} is already ${toOutboundDeliveryStatus(delivery.status)}`);
  }
}

async function syncServiceProfessionalLinks(tx: Prisma.TransactionClient, profile: ClinicProfile): Promise<void> {
  const serviceIds = profile.services.map((service) => service.id);
  const professionalIds = profile.professionals.map((professional) => professional.id);

  if (serviceIds.length === 0 || professionalIds.length === 0) {
    await tx.serviceProfessional.deleteMany({ where: { clinicId: profile.clinicId } });
    return;
  }

  await tx.serviceProfessional.deleteMany({
    where: {
      clinicId: profile.clinicId,
      OR: [{ serviceId: { notIn: serviceIds } }, { professionalId: { notIn: professionalIds } }]
    }
  });

  for (const service of profile.services) {
    if (service.professionalIds.length === 0) {
      await tx.serviceProfessional.deleteMany({
        where: { clinicId: profile.clinicId, serviceId: service.id }
      });
      continue;
    }

    await tx.serviceProfessional.deleteMany({
      where: {
        clinicId: profile.clinicId,
        serviceId: service.id,
        professionalId: { notIn: service.professionalIds }
      }
    });

    for (const professionalId of service.professionalIds) {
      await tx.serviceProfessional.upsert({
        where: {
          clinicId_serviceId_professionalId: {
            clinicId: profile.clinicId,
            serviceId: service.id,
            professionalId
          }
        },
        create: {
          clinicId: profile.clinicId,
          serviceId: service.id,
          professionalId
        },
        update: {}
      });
    }
  }
}

async function pruneStaleProfileRows(tx: Prisma.TransactionClient, profile: ClinicProfile): Promise<void> {
  await tx.service.deleteMany({
    where: {
      clinicId: profile.clinicId,
      id: { notIn: profile.services.map((service) => service.id) },
      serviceProfessionals: { none: {} },
      appointments: { none: {} },
      patientInterests: { none: {} }
    }
  });

  await tx.professional.deleteMany({
    where: {
      clinicId: profile.clinicId,
      id: { notIn: profile.professionals.map((professional) => professional.id) },
      serviceProfessionals: { none: {} },
      appointments: { none: {} },
      patientInterests: { none: {} }
    }
  });
}

function serializePendingBooking(pendingBooking: PendingBooking | undefined): string | null {
  if (!pendingBooking) return null;
  return JSON.stringify({
    ...pendingBooking,
    startsAt: pendingBooking.startsAt.toISOString(),
    endsAt: pendingBooking.endsAt.toISOString()
  });
}

function parsePendingBooking(json: string | null): PendingBooking | undefined {
  if (!json) return undefined;
  const pendingBooking = JSON.parse(json) as PendingBookingJson;
  return {
    ...pendingBooking,
    startsAt: new Date(pendingBooking.startsAt),
    endsAt: new Date(pendingBooking.endsAt)
  };
}

function serializeConversationMessages(messages: ConversationMessage[]) {
  return JSON.stringify(
    messages.map((message) => ({
      role: message.role,
      text: message.text,
      at: message.at.toISOString()
    }))
  );
}

function parseConversationMessages(json: string | null | undefined): ConversationMessage[] {
  if (!json) return [];
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(
      (message): message is ConversationMessageJson =>
        typeof message === "object" &&
        message !== null &&
        ((message as ConversationMessageJson).role === "patient" ||
          (message as ConversationMessageJson).role === "assistant") &&
        typeof (message as ConversationMessageJson).text === "string" &&
        typeof (message as ConversationMessageJson).at === "string"
    )
    .map((message) => ({
      role: message.role,
      text: message.text,
      at: new Date(message.at)
    }));
}

function cloneClinicProfile(profile: ClinicProfile): ClinicProfile {
  return {
    clinicId: profile.clinicId,
    name: profile.name,
    timezone: profile.timezone,
    services: profile.services.map((service) => ({
      ...service,
      restrictions: [...service.restrictions],
      professionalIds: [...service.professionalIds]
    })),
    professionals: profile.professionals.map((professional) => ({
      ...professional,
      workingHours: professional.workingHours.map((window) => ({ ...window }))
    })),
    appointmentRules: { ...profile.appointmentRules },
    requiredPatientFields: [...profile.requiredPatientFields]
  };
}

function cloneConversation(conversation: Conversation): Conversation {
  const clone: Conversation = {
    ...conversation,
    recentMessages: (conversation.recentMessages ?? []).map(cloneConversationMessage),
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt)
  };
  if (conversation.pendingBooking) {
    clone.pendingBooking = {
      ...conversation.pendingBooking,
      startsAt: new Date(conversation.pendingBooking.startsAt),
      endsAt: new Date(conversation.pendingBooking.endsAt)
    };
  }
  return clone;
}

function cloneConversationMessage(message: ConversationMessage): ConversationMessage {
  return {
    role: message.role,
    text: message.text,
    at: new Date(message.at)
  };
}

function toPatient(record: PatientRecord): Patient {
  return {
    id: record.id,
    whatsappNumber: record.whatsappNumber,
    ...(record.fullName ? { fullName: record.fullName } : {})
  };
}

function toClinicProfile(record: ClinicProfileRecord): ClinicProfile | undefined {
  const serviceProfessionalIds = new Map<string, string[]>();
  const linkedProfessionalIds = new Set<string>();
  for (const link of record.serviceProfessionals) {
    linkedProfessionalIds.add(link.professionalId);
    const professionalIds = serviceProfessionalIds.get(link.serviceId) ?? [];
    professionalIds.push(link.professionalId);
    serviceProfessionalIds.set(link.serviceId, professionalIds);
  }

  const services = record.services
    .map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      priceText: service.priceText,
      preparation: service.preparation,
      restrictions: parseStringArray(service.restrictionsJson),
      professionalIds: serviceProfessionalIds.get(service.id) ?? []
    }))
    .filter((service) => service.professionalIds.length > 0);
  const professionals = record.professionals
    .filter((professional) => linkedProfessionalIds.has(professional.id))
    .map((professional) => ({
      id: professional.id,
      name: professional.name,
      calendarId: professional.calendarId,
      workingHours: parseWorkingHours(professional.workingHoursJson)
    }));
  if (services.length === 0 || professionals.length === 0) {
    return undefined;
  }

  return parseClinicProfile({
    clinicId: record.id,
    name: record.name,
    timezone: record.timezone,
    services,
    professionals,
    appointmentRules: {
      minimumNoticeMinutes: record.minimumNoticeMinutes,
      cancellationNoticeMinutes: record.cancellationNoticeMinutes,
      bufferMinutes: record.bufferMinutes
    },
    requiredPatientFields: parsePatientFields(record.requiredPatientFieldsJson)
  });
}

function toAppointment(record: AppointmentRecord): Appointment {
  return {
    id: record.id,
    clinicId: record.clinicId,
    patientId: record.patientId,
    serviceId: record.serviceId,
    professionalId: record.professionalId,
    calendarEventId: record.calendarEventId,
    calendarId: record.calendarId,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    status: toAppointmentStatus(record.status)
  };
}

function toConversation(record: ConversationRecord): Conversation {
  return cloneConversation({
    id: record.id,
    clinicId: record.clinicId,
    patientId: record.patientId,
    botPaused: record.botPaused,
    pendingBooking: parsePendingBooking(record.pendingBookingJson),
    recentMessages: parseConversationMessages(record.recentMessagesJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function toPatientInterest(record: PatientInterestRecord): PatientInterest {
  return {
    id: record.id,
    clinicId: record.clinicId,
    patientId: record.patientId,
    serviceId: record.serviceId,
    ...(record.professionalId ? { professionalId: record.professionalId } : {}),
    preferredFrom: record.preferredFrom,
    preferredTo: record.preferredTo,
    status: toInterestStatus(record.status)
  };
}

function toWebhookDelivery(record: WebhookDeliveryPrismaRecord): WebhookDeliveryRecord {
  return {
    provider: "kapso",
    idempotencyKey: record.idempotencyKey,
    clinicId: record.clinicId,
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
    ...(record.outboundProviderMessageId ? { outboundProviderMessageId: record.outboundProviderMessageId } : {}),
    status: toWebhookDeliveryStatus(record.status),
    ...(record.responseText ? { responseText: record.responseText } : {}),
    ...(record.workflowResult ? { workflowResult: toWebhookDeliveryWorkflowResult(record.workflowResult) } : {})
  };
}

function toOutboundDelivery(record: OutboundDeliveryPrismaRecord): OutboundDeliveryRecord {
  return {
    id: record.id,
    key: record.deliveryKey,
    clinicId: record.clinicId,
    automationType: toOutboundAutomationType(record.automationType),
    status: toOutboundDeliveryStatus(record.status),
    toWhatsappNumber: record.toWhatsappNumber,
    ...(record.patientId ? { patientId: record.patientId } : {}),
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(record.appointmentId ? { appointmentId: record.appointmentId } : {}),
    templateName: record.templateName,
    metadata: parseOutboundMetadata(record.metadataJson),
    ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {}),
    claimedAt: record.claimedAt,
    ...(record.sentAt ? { sentAt: record.sentAt } : {}),
    ...(record.blockedAt ? { blockedAt: record.blockedAt } : {}),
    ...(record.failedAt ? { failedAt: record.failedAt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toAppointmentStatus(status: string): Appointment["status"] {
  if (status === "scheduled" || status === "cancelled") return status;
  throw new Error(`Unknown appointment status: ${status}`);
}

function toInterestStatus(status: string): PatientInterest["status"] {
  if (status === "active" || status === "fulfilled" || status === "expired") return status;
  throw new Error(`Unknown patient interest status: ${status}`);
}

function toWebhookDeliveryStatus(status: string): WebhookDeliveryRecord["status"] {
  if (status === "processing" || status === "response_ready" || status === "processed") return status;
  throw new Error(`Unknown webhook delivery status: ${status}`);
}

function toWebhookDeliveryWorkflowResult(workflowResult: string): NonNullable<WebhookDeliveryRecord["workflowResult"]> {
  if (workflowResult === "reply" || workflowResult === "handoff") return workflowResult;
  throw new Error(`Unknown webhook delivery workflow result: ${workflowResult}`);
}

function toOutboundAutomationType(value: string): OutboundAutomationType {
  if (value === "reminder" || value === "reactivation" || value === "freed_slot") return value;
  throw new Error(`Unknown outbound automation type: ${value}`);
}

function toOutboundDeliveryStatus(value: string): OutboundDeliveryStatus {
  if (value === "claimed" || value === "sent" || value === "failed" || value === "blocked") return value;
  throw new Error(`Unknown outbound delivery status: ${value}`);
}

function parseOutboundMetadata(metadataJson: string): Record<string, string> {
  const metadata = JSON.parse(metadataJson) as unknown;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Outbound delivery metadata must be an object");
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string") {
      throw new Error(`Outbound delivery metadata value for ${key} must be a string`);
    }
  }

  return { ...(metadata as Record<string, string>) };
}

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected JSON string array");
  }
  return value;
}

function parsePatientFields(json: string): PatientField[] {
  const fields = parseStringArray(json);
  const allowed = new Set<string>(patientFields);
  for (const field of fields) {
    if (!allowed.has(field)) {
      throw new Error(`Unknown patient field: ${field}`);
    }
  }
  return fields as PatientField[];
}

function parseWorkingHours(json: string): WorkingWindow[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("Professional working hours must be an array");
  }
  return value as WorkingWindow[];
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function withKeyedLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queuedLock = previous.catch(() => undefined).then(() => currentLock);

  locks.set(key, queuedLock);
  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queuedLock) {
      locks.delete(key);
    }
  }
}

type PendingBookingJson = Omit<PendingBooking, "startsAt" | "endsAt"> & {
  startsAt: string;
  endsAt: string;
};

type ConversationMessageJson = Omit<ConversationMessage, "at"> & {
  at: string;
};
