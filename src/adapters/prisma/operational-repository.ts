import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";
import type {
  Conversation,
  OperationalRepository,
  PatientInterest,
  PendingBooking,
  ProcessedWebhookDeliveryInput
} from "../../ports/repositories.js";

type PatientRecord = { id: string; whatsappNumber: string; fullName: string | null };

type ConversationRecord = {
  id: string;
  clinicId: string;
  patientId: string;
  botPaused: boolean;
  pendingBookingJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class PrismaOperationalRepository implements OperationalRepository {
  private clinicProfiles = new Map<string, ClinicProfile>();
  private appointmentCounter = 0;
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
            calendarId: professional.calendarId
          },
          update: {
            name: professional.name,
            calendarId: professional.calendarId
          }
        });
      }

      await syncServiceProfessionalLinks(tx, profile);
    });

    this.clinicProfiles.set(profile.clinicId, cloneClinicProfile(profile));
  }

  async getClinicProfile(clinicId: Id): Promise<ClinicProfile | undefined> {
    const profile = this.clinicProfiles.get(clinicId);
    return profile ? cloneClinicProfile(profile) : undefined;
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
      where: { id: conversation.id },
      create: {
        id: conversation.id,
        clinicId: conversation.clinicId,
        patientId: conversation.patientId,
        botPaused: conversation.botPaused,
        pendingBookingJson: serializePendingBooking(conversation.pendingBooking),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      },
      update: {
        clinicId: conversation.clinicId,
        patientId: conversation.patientId,
        botPaused: conversation.botPaused,
        pendingBookingJson: serializePendingBooking(conversation.pendingBooking),
        updatedAt: conversation.updatedAt
      }
    });
  }

  async getConversation(conversationId: Id): Promise<Conversation | undefined> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    return conversation ? toConversation(conversation) : undefined;
  }

  async saveAppointment(_appointment: Appointment): Promise<void> {
    throw new Error("Prisma appointment persistence is not implemented yet");
  }

  async nextAppointmentId(): Promise<Id> {
    this.appointmentCounter += 1;
    return `appt_${this.appointmentCounter}`;
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

  async getAppointment(_appointmentId: Id): Promise<Appointment | undefined> {
    return undefined;
  }

  async listAppointmentsByPatient(_patientId: Id): Promise<Appointment[]> {
    return [];
  }

  async saveInterest(_interest: PatientInterest): Promise<void> {
    throw new Error("Prisma patient interest persistence is not implemented yet");
  }

  async listActiveInterests(): Promise<PatientInterest[]> {
    return [];
  }

  async markOptOut(whatsappNumber: string): Promise<void> {
    await this.prisma.patient.updateMany({
      where: { whatsappNumber },
      data: { optedOut: true }
    });
  }

  async isOptedOut(whatsappNumber: string): Promise<boolean> {
    const patient = await this.prisma.patient.findUnique({
      where: { whatsappNumber },
      select: { optedOut: true }
    });
    return patient?.optedOut ?? false;
  }

  async hasProcessedWebhookDelivery(idempotencyKey: string): Promise<boolean> {
    const delivery = await this.prisma.processedWebhookDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: "kapso", idempotencyKey } }
    });
    return delivery !== null;
  }

  async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): Promise<void> {
    const delivery =
      typeof input === "string"
        ? { provider: "kapso" as const, idempotencyKey: input, clinicId: "clinic_1" }
        : input;

    try {
      await this.prisma.processedWebhookDelivery.create({ data: delivery });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) return;
      throw error;
    }
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

function toPatient(record: PatientRecord): Patient {
  return {
    id: record.id,
    whatsappNumber: record.whatsappNumber,
    ...(record.fullName ? { fullName: record.fullName } : {})
  };
}

function toConversation(record: ConversationRecord): Conversation {
  return cloneConversation({
    id: record.id,
    clinicId: record.clinicId,
    patientId: record.patientId,
    botPaused: record.botPaused,
    pendingBooking: parsePendingBooking(record.pendingBookingJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
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
