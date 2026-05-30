import type { Appointment, ClinicProfile, Id, Patient } from "../domain/types.js";

export type MaybePromise<T> = T | Promise<T>;

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

export type ConversationLookup = {
  clinicId: Id;
  conversationId: Id;
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

export type ProcessedWebhookDeliveryInput = {
  provider: "kapso";
  idempotencyKey: string;
  clinicId: string;
  conversationId?: string;
  providerMessageId?: string;
  outboundProviderMessageId?: string;
};

export type WebhookDeliveryStatus = "processing" | "response_ready" | "processed";

export type WebhookDeliveryRecord = ProcessedWebhookDeliveryInput & {
  status: WebhookDeliveryStatus;
  responseText?: string;
  workflowResult?: "reply" | "handoff";
};

export type WebhookDeliveryClaim =
  | { kind: "new"; delivery: WebhookDeliveryRecord }
  | { kind: "retry"; delivery: WebhookDeliveryRecord }
  | { kind: "existing"; delivery: WebhookDeliveryRecord };

export type WebhookDeliveryOutcomeInput = ProcessedWebhookDeliveryInput & {
  responseText: string;
  workflowResult: "reply" | "handoff";
};

export interface OperationalRepository {
  upsertClinicProfile(profile: ClinicProfile): MaybePromise<void>;
  getClinicProfile(clinicId: Id): MaybePromise<ClinicProfile | undefined>;
  upsertPatient(patient: Patient): MaybePromise<void>;
  getPatient(patientId: Id): MaybePromise<Patient | undefined>;
  saveConversation(conversation: Conversation): MaybePromise<void>;
  getConversation(lookup: ConversationLookup): MaybePromise<Conversation | undefined>;
  saveAppointment(appointment: Appointment): MaybePromise<void>;
  nextAppointmentId(): MaybePromise<Id>;
  withAppointmentLock<T>(appointmentId: Id, operation: () => Promise<T>): Promise<T>;
  withConversationLock<T>(conversationId: Id, operation: () => Promise<T>): Promise<T>;
  withWebhookDeliveryLock<T>(idempotencyKey: string, operation: () => Promise<T>): Promise<T>;
  getAppointment(appointmentId: Id): MaybePromise<Appointment | undefined>;
  listAppointmentsByPatient(patientId: Id): MaybePromise<Appointment[]>;
  saveInterest(interest: PatientInterest): MaybePromise<void>;
  listActiveInterests(): MaybePromise<PatientInterest[]>;
  markOptOut(whatsappNumber: string): MaybePromise<void>;
  isOptedOut(whatsappNumber: string): MaybePromise<boolean>;
  claimWebhookDelivery(input: ProcessedWebhookDeliveryInput): MaybePromise<WebhookDeliveryClaim>;
  releaseWebhookDeliveryClaim(input: ProcessedWebhookDeliveryInput): MaybePromise<void>;
  getWebhookDelivery(idempotencyKey: string): MaybePromise<WebhookDeliveryRecord | undefined>;
  saveWebhookDeliveryOutcome(input: WebhookDeliveryOutcomeInput): MaybePromise<void>;
  markWebhookDeliveryReadyForRetry(input: ProcessedWebhookDeliveryInput): MaybePromise<void>;
  hasProcessedWebhookDelivery(idempotencyKey: string): MaybePromise<boolean>;
  markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): MaybePromise<void>;
}
