import type { GoogleCalendarSummary } from "./types";

export type CalendarMappingProfessional = {
  id: string;
  name: string;
  calendarId?: string;
};

export type CalendarMappingService = {
  id: string;
  name: string;
  professionalIds: string[];
};

export type CalendarMappingWarnings = {
  duplicateCalendarIds: string[];
  nonBookableCalendarNames: string[];
  unmappedServiceNames: string[];
};

export function calendarMappingWarnings(input: {
  calendars: GoogleCalendarSummary[];
  professionals: CalendarMappingProfessional[];
  services: CalendarMappingService[];
}): CalendarMappingWarnings {
  const calendarsById = new Map(input.calendars.map((calendar) => [calendar.id, calendar]));
  const calendarsLoaded = input.calendars.length > 0;
  const professionalsById = new Map(input.professionals.map((professional) => [professional.id, professional]));
  const seenCalendarIds = new Set<string>();
  const duplicateCalendarIds = new Set<string>();

  for (const professional of input.professionals) {
    if (!professional.calendarId) {
      continue;
    }
    if (seenCalendarIds.has(professional.calendarId)) {
      duplicateCalendarIds.add(professional.calendarId);
      continue;
    }
    seenCalendarIds.add(professional.calendarId);
  }

  const unmappedServiceNames = input.services
    .filter((service) =>
      service.professionalIds.some((professionalId) => {
        const professional = professionalsById.get(professionalId);
        if (!professional?.calendarId) {
          return true;
        }
        if (!calendarsLoaded) {
          return false;
        }
        return calendarsById.get(professional.calendarId)?.bookable !== true;
      })
    )
    .map((service) => service.name);

  return {
    duplicateCalendarIds: [...duplicateCalendarIds],
    nonBookableCalendarNames: input.calendars
      .filter((calendar) => !calendar.bookable)
      .map((calendar) => calendar.summary),
    unmappedServiceNames
  };
}
