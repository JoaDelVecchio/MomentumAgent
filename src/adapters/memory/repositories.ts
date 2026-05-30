import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";

export type PendingBooking = {
  appointmentId?: Id;
  serviceId: Id;
  professionalId: Id;
  startsAt: Date;
  endsAt: Date;
};

export type Conversation = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  botPaused: boolean;
  pendingBooking?: PendingBooking;
  createdAt: Date;
  updatedAt: Date;
};

export type PatientInterest = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  serviceId: Id;
  professionalId?: Id;
  preferredFrom: Date;
  preferredTo: Date;
  status: "active" | "fulfilled" | "expired";
};

export class InMemoryRepositories {
  private clinicProfiles = new Map<Id, ClinicProfile>();
  private patients = new Map<Id, Patient>();
  private conversations = new Map<Id, Conversation>();
  private appointments = new Map<Id, Appointment>();
  private interests = new Map<Id, PatientInterest>();
  private optOutWhatsappNumbers = new Set<string>();
  private processedWebhookDeliveries = new Set<string>();
  private appointmentCounter = 0;
  private appointmentLocks = new Map<Id, Promise<unknown>>();

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
    const previous = this.appointmentLocks.get(appointmentId) ?? Promise.resolve();
    let release: () => void = () => {};
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedLock = previous.catch(() => undefined).then(() => currentLock);

    this.appointmentLocks.set(appointmentId, queuedLock);
    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release();
      if (this.appointmentLocks.get(appointmentId) === queuedLock) {
        this.appointmentLocks.delete(appointmentId);
      }
    }
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
    return this.processedWebhookDeliveries.has(idempotencyKey);
  }

  markProcessedWebhookDelivery(idempotencyKey: string) {
    this.processedWebhookDeliveries.add(idempotencyKey);
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
