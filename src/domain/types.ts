export type Id = string;

export const patientFields = ["fullName", "email", "dni", "insurance"] as const;

export type PatientField = "fullName" | "email" | "dni" | "insurance";

export type Service = {
  id: Id;
  name: string;
  durationMinutes: number;
  priceText: string;
  preparation: string;
  restrictions: string[];
  professionalIds: Id[];
};

export type Professional = {
  id: Id;
  name: string;
  calendarId: Id;
};

export type AppointmentRules = {
  minimumNoticeMinutes: number;
  cancellationNoticeMinutes: number;
  bufferMinutes: number;
};

export type ClinicProfile = {
  clinicId: Id;
  name: string;
  timezone: string;
  services: Service[];
  professionals: Professional[];
  appointmentRules: AppointmentRules;
  requiredPatientFields: PatientField[];
};

export type Patient = {
  id: Id;
  whatsappNumber: string;
  fullName?: string;
};

export type AppointmentStatus = "scheduled" | "cancelled";

export type Appointment = {
  id: Id;
  clinicId: Id;
  patientId: Id;
  serviceId: Id;
  professionalId: Id;
  calendarEventId: Id;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
};

export type TimeSlot = {
  professionalId: Id;
  calendarId: Id;
  startsAt: Date;
  endsAt: Date;
};
