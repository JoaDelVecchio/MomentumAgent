import type { PatientInterest } from "../../adapters/memory/repositories.js";
import type { TimeSlot } from "../../domain/types.js";

type MatchFreedSlotInput = {
  clinicId: string;
  slot: TimeSlot;
  interests: PatientInterest[];
  serviceId?: string;
};

export function matchFreedSlot(input: MatchFreedSlotInput) {
  const matches = input.interests.filter((interest) => {
    const active = interest.status === "active";
    const clinicMatches = interest.clinicId === input.clinicId;
    const serviceMatches = input.serviceId ? interest.serviceId === input.serviceId : true;
    const professionalMatches = interest.professionalId ? interest.professionalId === input.slot.professionalId : true;
    const insidePreference = input.slot.startsAt >= interest.preferredFrom && input.slot.endsAt <= interest.preferredTo;

    return active && clinicMatches && serviceMatches && professionalMatches && insidePreference;
  });

  return matches.sort((a, b) => scoreInterest(b, input.slot) - scoreInterest(a, input.slot))[0];
}

function scoreInterest(interest: PatientInterest, slot: TimeSlot) {
  const exactProfessionalPreference = interest.professionalId === slot.professionalId ? 100 : 0;
  const preferenceWindowMinutes = (interest.preferredTo.getTime() - interest.preferredFrom.getTime()) / 60000;
  return exactProfessionalPreference - preferenceWindowMinutes;
}
