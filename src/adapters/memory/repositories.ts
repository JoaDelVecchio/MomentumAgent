import type { Appointment, ClinicProfile, Id, Patient } from "../../domain/types.js";
import type {
  Conversation,
  ConversationMessage,
  ConversationByPatientLookup,
  ConversationLookup,
  ListScheduledAppointmentsInput,
  OperationalRepository,
  OutboundDeliveryClaim,
  OutboundDeliveryClaimInput,
  OutboundDeliveryRecord,
  PatientInterest,
  PendingBooking,
  ProcessedWebhookDeliveryInput,
  WebhookDeliveryClaim,
  WebhookDeliveryOutcomeInput,
  WebhookDeliveryRecord
} from "../../ports/repositories.js";

export type { Conversation, PatientInterest, PendingBooking };

export class InMemoryRepositories implements OperationalRepository {
  private clinicProfiles = new Map<Id, ClinicProfile>();
  private patients = new Map<Id, Patient>();
  private conversations = new Map<Id, Conversation>();
  private appointments = new Map<Id, Appointment>();
  private interests = new Map<Id, PatientInterest>();
  private optOutWhatsappNumbers = new Set<string>();
  private webhookDeliveries = new Map<string, WebhookDeliveryRecord>();
  private outboundDeliveries = new Map<string, OutboundDeliveryRecord>();
  private appointmentCounter = 0;
  private outboundDeliveryCounter = 0;
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
    this.conversations.set(conversationKey(conversation), cloneConversation(conversation));
  }

  getConversation(lookup: ConversationLookup) {
    const conversation = this.conversations.get(conversationKey({ clinicId: lookup.clinicId, id: lookup.conversationId }));
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

  listScheduledAppointments(input: ListScheduledAppointmentsInput) {
    return [...this.appointments.values()]
      .filter(
        (appointment) =>
          appointment.clinicId === input.clinicId &&
          appointment.status === "scheduled" &&
          appointment.startsAt.getTime() >= input.from.getTime() &&
          appointment.startsAt.getTime() <= input.to.getTime()
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((appointment) => cloneAppointment(appointment));
  }

  listConversationsByClinic(clinicId: Id) {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.clinicId === clinicId)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map((conversation) => cloneConversation(conversation));
  }

  listConversationsByPatient(lookup: ConversationByPatientLookup) {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.clinicId === lookup.clinicId && conversation.patientId === lookup.patientId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((conversation) => cloneConversation(conversation));
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
    return this.getWebhookDelivery(idempotencyKey)?.status === "processed";
  }

  claimWebhookDelivery(input: ProcessedWebhookDeliveryInput): WebhookDeliveryClaim {
    const existing = this.getWebhookDelivery(input.idempotencyKey);
    if (existing) {
      if (existing.status === "response_ready" && existing.responseText && existing.workflowResult) {
        const delivery: WebhookDeliveryRecord = { ...existing, ...input, status: "processing" };
        this.webhookDeliveries.set(deliveryKey(input), delivery);
        return { kind: "retry", delivery: cloneWebhookDelivery(delivery) };
      }
      return { kind: "existing", delivery: existing };
    }

    const delivery: WebhookDeliveryRecord = { ...input, status: "processing" };
    this.webhookDeliveries.set(deliveryKey(input), delivery);
    return { kind: "new", delivery: cloneWebhookDelivery(delivery) };
  }

  releaseWebhookDeliveryClaim(input: ProcessedWebhookDeliveryInput) {
    const existing = this.getWebhookDelivery(input.idempotencyKey);
    if (existing?.status === "processing" && !existing.responseText && !existing.workflowResult) {
      this.webhookDeliveries.delete(deliveryKey(input));
    }
  }

  getWebhookDelivery(idempotencyKey: string) {
    const delivery =
      this.webhookDeliveries.get(idempotencyKey) ?? this.webhookDeliveries.get(`kapso:${idempotencyKey}`);
    return delivery ? cloneWebhookDelivery(delivery) : undefined;
  }

  saveWebhookDeliveryOutcome(input: WebhookDeliveryOutcomeInput) {
    const existing = this.getWebhookDelivery(input.idempotencyKey);
    this.webhookDeliveries.set(deliveryKey(input), {
      ...existing,
      ...input,
      status: "processing"
    });
  }

  markWebhookDeliveryReadyForRetry(input: ProcessedWebhookDeliveryInput) {
    const existing = this.getWebhookDelivery(input.idempotencyKey);
    if (!existing) {
      return;
    }

    this.webhookDeliveries.set(deliveryKey(input), {
      ...existing,
      ...input,
      status: "response_ready"
    });
  }

  markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
    const delivery = normalizeProcessedWebhookDelivery(input);
    const existing = this.getWebhookDelivery(delivery.idempotencyKey);
    this.webhookDeliveries.set(deliveryKey(delivery), {
      ...existing,
      ...delivery,
      status: "processed"
    });
  }

  claimOutboundDelivery(input: OutboundDeliveryClaimInput): OutboundDeliveryClaim {
    const existing = this.getOutboundDelivery(input.key);
    if (existing) {
      return { kind: "existing", delivery: existing };
    }

    this.outboundDeliveryCounter += 1;
    const now = new Date(input.now);
    const delivery: OutboundDeliveryRecord = {
      key: input.key,
      clinicId: input.clinicId,
      automationType: input.automationType,
      toWhatsappNumber: input.toWhatsappNumber,
      patientId: input.patientId,
      conversationId: input.conversationId,
      appointmentId: input.appointmentId,
      templateName: input.templateName,
      metadata: { ...input.metadata },
      id: `outbound_${this.outboundDeliveryCounter}`,
      status: "claimed",
      claimedAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.outboundDeliveries.set(input.key, cloneOutboundDelivery(delivery));
    return { kind: "new", delivery: cloneOutboundDelivery(delivery) };
  }

  getOutboundDelivery(key: string) {
    const delivery = this.outboundDeliveries.get(key);
    return delivery ? cloneOutboundDelivery(delivery) : undefined;
  }

  markOutboundDeliverySent(input: { key: string; providerMessageId: string; sentAt: Date }) {
    const delivery = this.requireClaimedOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...delivery,
      status: "sent",
      providerMessageId: input.providerMessageId,
      sentAt: new Date(input.sentAt),
      updatedAt: new Date(input.sentAt)
    });
  }

  markOutboundDeliveryBlocked(input: { key: string; reason: string; blockedAt: Date }) {
    const delivery = this.requireClaimedOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...delivery,
      status: "blocked",
      failureReason: input.reason,
      blockedAt: new Date(input.blockedAt),
      updatedAt: new Date(input.blockedAt)
    });
  }

  markOutboundDeliveryFailed(input: { key: string; reason: string; failedAt: Date }) {
    const delivery = this.requireClaimedOutboundDelivery(input.key);
    this.outboundDeliveries.set(input.key, {
      ...delivery,
      status: "failed",
      failureReason: input.reason,
      failedAt: new Date(input.failedAt),
      updatedAt: new Date(input.failedAt)
    });
  }

  private requireOutboundDelivery(key: string) {
    const delivery = this.outboundDeliveries.get(key);
    if (!delivery) {
      throw new Error(`Outbound delivery ${key} not found`);
    }
    return cloneOutboundDelivery(delivery);
  }

  private requireClaimedOutboundDelivery(key: string) {
    const delivery = this.requireOutboundDelivery(key);
    if (delivery.status !== "claimed") {
      throw new Error(`Outbound delivery ${key} is already ${delivery.status}`);
    }
    return delivery;
  }
}

function conversationKey(input: { clinicId: Id; id: Id }) {
  return `${input.clinicId}:${input.id}`;
}

function deliveryKey(input: string | ProcessedWebhookDeliveryInput) {
  return typeof input === "string" ? input : `${input.provider}:${input.idempotencyKey}`;
}

function normalizeProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): ProcessedWebhookDeliveryInput {
  return typeof input === "string"
    ? { provider: "kapso", idempotencyKey: input, clinicId: "clinic_1" }
    : input;
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

function cloneWebhookDelivery(delivery: WebhookDeliveryRecord): WebhookDeliveryRecord {
  return { ...delivery };
}

function cloneOutboundDelivery(delivery: OutboundDeliveryRecord): OutboundDeliveryRecord {
  return {
    ...delivery,
    metadata: { ...delivery.metadata },
    claimedAt: new Date(delivery.claimedAt),
    sentAt: delivery.sentAt ? new Date(delivery.sentAt) : undefined,
    blockedAt: delivery.blockedAt ? new Date(delivery.blockedAt) : undefined,
    failedAt: delivery.failedAt ? new Date(delivery.failedAt) : undefined,
    createdAt: new Date(delivery.createdAt),
    updatedAt: new Date(delivery.updatedAt)
  };
}
