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

export type WorkingDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WorkingWindow = {
  day: WorkingDay;
  startTime: string;
  endTime: string;
};

export type Professional = {
  id: Id;
  name: string;
  calendarId: Id;
  workingHours: WorkingWindow[];
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
  calendarId: Id;
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
