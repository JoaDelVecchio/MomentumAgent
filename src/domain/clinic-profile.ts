import { z } from "zod";
import { DomainError } from "./errors.js";
import { patientFields, type ClinicProfile } from "./types.js";

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
      calendarId: z.string().min(1)
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
