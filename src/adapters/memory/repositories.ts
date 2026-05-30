import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";
import type {
  Conversation,
  OperationalRepository,
  PatientInterest,
  PendingBooking,
  ProcessedWebhookDeliveryInput
} from "../../ports/repositories.js";

export type { Conversation, PatientInterest, PendingBooking };

export class InMemoryRepositories implements OperationalRepository {
  private clinicProfiles = new Map<Id, ClinicProfile>();
  private patients = new Map<Id, Patient>();
  private conversations = new Map<Id, Conversation>();
  private appointments = new Map<Id, Appointment>();
  private interests = new Map<Id, PatientInterest>();
  private optOutWhatsappNumbers = new Set<string>();
  private processedWebhookDeliveries = new Set<string>();
  private appointmentCounter = 0;
  private appointmentLocks = new Map<Id, Promise<unknown>>();
  private conversationLocks = new Map<Id, Promise<unknown>>();
  private webhookDeliveryLocks = new Map<string, Promise<unknown>>();

  upsertClinicProfile(profile: ClinicProfile) {
    this.clinicProfiles.set(profile.clinicId, cloneClinicProfile(profile));
  }

  getClinicProfile(clinicId: Id) {
    const profile = this.clinicProfiles.get(clinicId);
    return profile ? cloneClinicProfile(profile) : undefined;
  }

  upsertPatient(patient: Patient) {
    this.patients.set(patient.id, clonePatient(patient));
  }

  getPatient(patientId: Id) {
    const patient = this.patients.get(patientId);
    return patient ? clonePatient(patient) : undefined;
  }

  saveConversation(conversation: Conversation) {
    this.conversations.set(conversation.id, cloneConversation(conversation));
  }

  getConversation(conversationId: Id) {
    const conversation = this.conversations.get(conversationId);
    return conversation ? cloneConversation(conversation) : undefined;
  }

  saveAppointment(appointment: Appointment) {
    this.appointments.set(appointment.id, cloneAppointment(appointment));
  }

  nextAppointmentId() {
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

  getAppointment(appointmentId: Id) {
    const appointment = this.appointments.get(appointmentId);
    return appointment ? cloneAppointment(appointment) : undefined;
  }

  listAppointmentsByPatient(patientId: Id) {
    return [...this.appointments.values()]
      .filter((appointment) => appointment.patientId === patientId)
      .map((appointment) => cloneAppointment(appointment));
  }

  saveInterest(interest: PatientInterest) {
    this.interests.set(interest.id, clonePatientInterest(interest));
  }

  listActiveInterests() {
    return [...this.interests.values()]
      .filter((interest) => interest.status === "active")
      .map((interest) => clonePatientInterest(interest));
  }

  markOptOut(whatsappNumber: string) {
    this.optOutWhatsappNumbers.add(whatsappNumber);
  }

  isOptedOut(whatsappNumber: string) {
    return this.optOutWhatsappNumbers.has(whatsappNumber);
  }

  hasProcessedWebhookDelivery(idempotencyKey: string) {
    return (
      this.processedWebhookDeliveries.has(idempotencyKey) ||
      this.processedWebhookDeliveries.has(`kapso:${idempotencyKey}`)
    );
  }

  markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
    this.processedWebhookDeliveries.add(deliveryKey(input));
  }
}

function deliveryKey(input: string | ProcessedWebhookDeliveryInput) {
  return typeof input === "string" ? input : `${input.provider}:${input.idempotencyKey}`;
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
    professionals: profile.professionals.map((professional) => ({ ...professional })),
    appointmentRules: { ...profile.appointmentRules },
    requiredPatientFields: [...profile.requiredPatientFields]
  };
}

function clonePatient(patient: Patient): Patient {
  return { ...patient };
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

function cloneAppointment(appointment: Appointment): Appointment {
  return {
    ...appointment,
    startsAt: new Date(appointment.startsAt),
    endsAt: new Date(appointment.endsAt)
  };
}

function clonePatientInterest(interest: PatientInterest): PatientInterest {
  return {
    ...interest,
    preferredFrom: new Date(interest.preferredFrom),
    preferredTo: new Date(interest.preferredTo)
  };
}
