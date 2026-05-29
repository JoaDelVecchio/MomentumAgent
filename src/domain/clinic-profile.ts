import { z } from "zod";
import { DomainError } from "./errors.js";
import { patientFields, type ClinicProfile } from "./types.js";

const workingDaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6)
]);

const workingTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const workingWindowSchema = z
  .object({
    day: workingDaySchema,
    startTime: workingTimeSchema,
    endTime: workingTimeSchema
  })
  .superRefine((workingWindow, ctx) => {
    if (minutesFromTime(workingWindow.endTime) <= minutesFromTime(workingWindow.startTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Working hour end time must be after start time",
        path: ["endTime"]
      });
    }
  });

const clinicProfileSchema = z.object({
  clinicId: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  services: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      durationMinutes: z.number().int().positive(),
      priceText: z.string().min(1),
      preparation: z.string(),
      restrictions: z.array(z.string()),
      professionalIds: z.array(z.string().min(1)).min(1)
    })
  ),
  professionals: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      calendarId: z.string().min(1),
      workingHours: z.array(workingWindowSchema).default([])
    })
  ),
  appointmentRules: z.object({
    minimumNoticeMinutes: z.number().int().nonnegative(),
    cancellationNoticeMinutes: z.number().int().nonnegative(),
    bufferMinutes: z.number().int().nonnegative()
  }),
  requiredPatientFields: z.array(z.enum(patientFields))
});

export type ClinicProfileInput = z.input<typeof clinicProfileSchema>;

export function parseClinicProfile(input: ClinicProfileInput): ClinicProfile {
  const profile = clinicProfileSchema.parse(input);
  const professionalIds = new Set(profile.professionals.map((professional) => professional.id));

  for (const service of profile.services) {
    for (const professionalId of service.professionalIds) {
      if (!professionalIds.has(professionalId)) {
        throw new DomainError(`Service ${service.id} references missing professional ${professionalId}`);
      }
    }
  }

  return profile;
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
