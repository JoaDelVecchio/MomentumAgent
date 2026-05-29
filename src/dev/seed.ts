import { InMemoryAuditLog } from "../adapters/memory/audit-log.js";
import { FakeCalendar } from "../adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../adapters/memory/repositories.js";
import { ConversationWorkflow } from "../application/conversations/conversation-workflow.js";
import { SchedulingService } from "../application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../domain/clinic-profile.js";

type BuildDevContainerOptions = {
  now?: Date;
};

export function buildDevContainer(options: BuildDevContainerOptions = {}) {
  const now = options.now ?? new Date();
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();

  repos.upsertClinicProfile(
    parseClinicProfile({
      clinicId: "clinic_1",
      name: "Clinica Demo",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "Evitar alcohol 24 horas antes.",
          restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  const firstSlotStart = atUtcHour(addDays(startOfDay(now), 3), 13, 0);
  const secondSlotStart = atUtcHour(addDays(startOfDay(now), 3), 13, 30);
  calendar.seedAvailability("cal_perez", [
    { startsAt: firstSlotStart, endsAt: addMinutes(firstSlotStart, 30) },
    { startsAt: secondSlotStart, endsAt: addMinutes(secondSlotStart, 30) }
  ]);

  const scheduling = new SchedulingService(repos, calendar, audit);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => now);

  return { repos, calendar, audit, scheduling, workflow };
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function atUtcHour(date: Date, hours: number, minutes: number) {
  const next = new Date(date);
  next.setUTCHours(hours, minutes, 0, 0);
  return next;
}
