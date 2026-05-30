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
};

export interface OperationalRepository {
  upsertClinicProfile(profile: ClinicProfile): MaybePromise<void>;
  getClinicProfile(clinicId: Id): MaybePromise<ClinicProfile | undefined>;
  upsertPatient(patient: Patient): MaybePromise<void>;
  getPatient(patientId: Id): MaybePromise<Patient | undefined>;
  saveConversation(conversation: Conversation): MaybePromise<void>;
  getConversation(conversationId: Id): MaybePromise<Conversation | undefined>;
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
  hasProcessedWebhookDelivery(idempotencyKey: string): MaybePromise<boolean>;
  markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput): MaybePromise<void>;
}
