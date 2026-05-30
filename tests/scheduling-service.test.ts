import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import { DomainError } from "../src/domain/errors.js";
import type { CalendarEvent, CalendarEventInput, FindFreeSlotsInput } from "../src/ports/calendar.js";

class BlockingUpdateCalendar extends FakeCalendar {
  private readonly updateReleased: Promise<void>;
  private resolveUpdateStarted: () => void = () => {};
  private releaseUpdate: () => void = () => {};
  readonly updateStarted: Promise<void>;

  constructor() {
    super();
    this.updateStarted = new Promise((resolve) => {
      this.resolveUpdateStarted = resolve;
    });
    this.updateReleased = new Promise((resolve) => {
      this.releaseUpdate = resolve;
    });
  }

  unblockUpdate() {
    this.releaseUpdate();
  }

  override async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    this.resolveUpdateStarted();
    await this.updateReleased;
    return super.updateEvent(eventId, input);
  }
}

class CapturingFindSlotsCalendar extends FakeCalendar {
  readonly findFreeSlotsInputs: FindFreeSlotsInput[] = [];

  override async findFreeSlots(input: FindFreeSlotsInput) {
    this.findFreeSlotsInputs.push(input);
    return super.findFreeSlots(input);
  }
}

class CapturingCalendar extends FakeCalendar {
  readonly findFreeSlotsInputs: FindFreeSlotsInput[] = [];
  readonly updateEventInputs: Array<{ eventId: string; input: CalendarEventInput }> = [];
  readonly cancelEventInputs: Array<{ eventId: string; calendarId?: string }> = [];

  override async findFreeSlots(input: FindFreeSlotsInput) {
    this.findFreeSlotsInputs.push(input);
    return super.findFreeSlots(input);
  }

  override async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    this.updateEventInputs.push({ eventId, input });
    return super.updateEvent(eventId, input);
  }

  override async cancelEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    this.cancelEventInputs.push({ eventId, calendarId });
    return super.cancelEvent(eventId, calendarId);
  }
}

class FailingSaveRepository extends InMemoryRepositories {
  override saveAppointment() {
    throw new Error("database unavailable");
  }
}

function buildContext(calendar = new FakeCalendar(), now = () => new Date("2026-05-29T12:00:00.000Z")) {
  const repos = new InMemoryRepositories();
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
          restrictions: [],
          professionalIds: ["pro_perez", "pro_lopez"]
        }
      ],
      professionals: [
        {
          id: "pro_perez",
          name: "Dra. Perez",
          calendarId: "cal_perez",
          workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
        },
        { id: "pro_lopez", name: "Dra. Lopez", calendarId: "cal_lopez" }
      ],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );
  repos.upsertClinicProfile(
    parseClinicProfile({
      clinicId: "clinic_2",
      name: "Otra Clinica",
      timezone: "America/Argentina/Buenos_Aires",
      services: [
        {
          id: "svc_botox",
          name: "Botox",
          durationMinutes: 30,
          priceText: "Desde $120.000",
          preparation: "Evitar alcohol 24 horas antes.",
          restrictions: [],
          professionalIds: ["pro_otra"]
        }
      ],
      professionals: [{ id: "pro_otra", name: "Dra. Otra", calendarId: "cal_otra" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
  ]);

  return { repos, calendar, audit, service: new SchedulingService(repos, calendar, audit, now) };
}

describe("SchedulingService", () => {
  it("finds slots across compatible professionals and rejects incompatible professionals", async () => {
    const { calendar, service } = buildContext();
    calendar.seedAvailability("cal_lopez", [
      { startsAt: new Date("2026-06-01T14:00:00.000Z"), endsAt: new Date("2026-06-01T14:30:00.000Z") }
    ]);

    const slots = await service.findSlots({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z")
    });

    expect(slots).toEqual([
      {
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      {
        calendarId: "cal_lopez",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        endsAt: new Date("2026-06-01T14:30:00.000Z")
      }
    ]);

    await expect(
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T14:00:00.000Z"),
        professionalId: "pro_otra"
      })
    ).rejects.toThrow("Professional pro_otra cannot perform service svc_botox");
  });

  it("passes scheduling context to the calendar port for provider availability", async () => {
    const calendar = new CapturingFindSlotsCalendar();
    const { service } = buildContext(calendar);
    calendar.seedAvailability("cal_lopez", [
      { startsAt: new Date("2026-06-01T14:00:00.000Z"), endsAt: new Date("2026-06-01T14:30:00.000Z") }
    ]);

    await service.findSlots({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      from: new Date("2026-06-01T12:00:00.000Z"),
      to: new Date("2026-06-01T15:00:00.000Z")
    });

    expect(calendar.findFreeSlotsInputs[0]).toMatchObject({
      calendarIds: ["cal_perez", "cal_lopez"],
      durationMinutes: 30,
      availabilityContext: {
        timezone: "America/Argentina/Buenos_Aires",
        serviceDurationMinutes: 30,
        bufferMinutes: 0,
        professionals: [
          {
            id: "pro_perez",
            calendarId: "cal_perez",
            workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
          },
          {
            id: "pro_lopez",
            calendarId: "cal_lopez",
            workingHours: []
          }
        ]
      }
    });
  });

  it("books a compatible professional slot and audits the action", async () => {
    const { repos, audit, service } = buildContext();

    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    expect(appointment.status).toBe("scheduled");
    expect(repos.getAppointment(appointment.id)).toEqual(appointment);
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.created");
  });

  it("cancels a newly-created calendar event when appointment persistence fails", async () => {
    const calendar = new CapturingCalendar();
    const audit = new InMemoryAuditLog();
    const repos = new FailingSaveRepository();
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
            restrictions: [],
            professionalIds: ["pro_perez"]
          }
        ],
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
        requiredPatientFields: ["fullName"]
      })
    );
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    const service = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));

    await expect(
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        professionalId: "pro_perez",
        conversationId: "conv_1"
      })
    ).rejects.toThrow("database unavailable");

    expect(calendar.cancelEventInputs).toEqual([{ eventId: "evt_1", calendarId: "cal_perez" }]);
  });

  it("reschedules an appointment into a newly available slot", async () => {
    const { calendar, audit, service } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);

    const original = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    const rescheduled = await service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: original.id,
      startsAt: new Date("2026-06-02T14:00:00.000Z"),
      conversationId: "conv_1"
    });

    expect(rescheduled.startsAt).toEqual(new Date("2026-06-02T14:00:00.000Z"));
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.rescheduled");
  });

  it("allows rescheduling to the same slot as a no-op update", async () => {
    const { audit, service } = buildContext();
    const original = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    const rescheduled = await service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: original.id,
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      conversationId: "conv_1"
    });

    expect(rescheduled.startsAt).toEqual(original.startsAt);
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.rescheduled");
  });

  it("cancels an appointment and audits the action", async () => {
    const { audit, calendar, service } = buildContext();
    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    const cancelled = await service.cancelAppointment({
      clinicId: "clinic_1",
      appointmentId: appointment.id,
      conversationId: "conv_1"
    });

    expect(cancelled.status).toBe("cancelled");
    expect((await calendar.getEvent(appointment.calendarEventId))?.status).toBe("cancelled");
    expect((await audit.list()).map((event) => event.type)).toContain("appointment.cancelled");
  });

  it("uses the appointment calendar id when professional calendar mapping changes later", async () => {
    const calendar = new CapturingCalendar();
    const { repos, service } = buildContext(calendar);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);
    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });
    const profile = repos.getClinicProfile("clinic_1");
    if (!profile) {
      throw new Error("Missing test clinic");
    }
    repos.upsertClinicProfile({
      ...profile,
      professionals: profile.professionals.map((professional) =>
        professional.id === "pro_perez"
          ? { ...professional, calendarId: "cal_perez_new" }
          : professional
      )
    });

    await service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: appointment.id,
      startsAt: new Date("2026-06-02T14:00:00.000Z")
    });
    await service.cancelAppointment({ clinicId: "clinic_1", appointmentId: appointment.id });

    expect(appointment.calendarId).toBe("cal_perez");
    expect(calendar.findFreeSlotsInputs.at(-1)?.calendarIds).toEqual(["cal_perez"]);
    expect(calendar.updateEventInputs.at(-1)?.input.calendarId).toBe("cal_perez");
    expect(calendar.cancelEventInputs.at(-1)).toEqual({
      eventId: appointment.calendarEventId,
      calendarId: "cal_perez"
    });
  });

  it("does not mutate appointments across clinics", async () => {
    const { calendar, service } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);
    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez",
      conversationId: "conv_1"
    });

    await expect(
      service.cancelAppointment({ clinicId: "clinic_2", appointmentId: appointment.id })
    ).rejects.toThrow(`Appointment ${appointment.id} not found`);
    await expect(
      service.rescheduleAppointment({
        clinicId: "clinic_2",
        appointmentId: appointment.id,
        startsAt: new Date("2026-06-02T14:00:00.000Z")
      })
    ).rejects.toThrow(`Appointment ${appointment.id} not found`);
  });

  it("creates unique appointment ids for rapid bookings", async () => {
    const { calendar, service } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    const first = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });
    const second = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:30:00.000Z"),
      professionalId: "pro_perez"
    });

    expect(first.id).not.toBe(second.id);
  });

  it("keeps appointment ids unique across service instances sharing a repository", async () => {
    const { repos, calendar, audit, service } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T13:30:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    const first = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });
    const rebuiltService = new SchedulingService(repos, calendar, audit);
    const second = await rebuiltService.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:30:00.000Z"),
      professionalId: "pro_perez"
    });

    expect(first.id).toBe("appt_1");
    expect(second.id).toBe("appt_2");
  });

  it("blocks double booking and rescheduling cancelled appointments", async () => {
    const { service } = buildContext();
    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    await expect(
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        professionalId: "pro_perez"
      })
    ).rejects.toThrow("Selected slot is no longer available");

    await service.cancelAppointment({ clinicId: "clinic_1", appointmentId: appointment.id });

    await expect(
      service.rescheduleAppointment({
        clinicId: "clinic_1",
        appointmentId: appointment.id,
        startsAt: new Date("2026-06-02T14:00:00.000Z")
      })
    ).rejects.toThrow(`Appointment ${appointment.id} is cancelled`);
  });

  it("serializes concurrent cancel and reschedule for the same appointment", async () => {
    const calendar = new BlockingUpdateCalendar();
    const { repos, service } = buildContext(calendar);
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);
    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    const reschedulePromise = service.rescheduleAppointment({
      clinicId: "clinic_1",
      appointmentId: appointment.id,
      startsAt: new Date("2026-06-02T14:00:00.000Z")
    });
    await calendar.updateStarted;

    const cancelPromise = service.cancelAppointment({
      clinicId: "clinic_1",
      appointmentId: appointment.id
    });
    calendar.unblockUpdate();

    const [rescheduled, cancelled] = await Promise.all([reschedulePromise, cancelPromise]);

    expect(rescheduled.startsAt).toEqual(new Date("2026-06-02T14:00:00.000Z"));
    expect(cancelled.status).toBe("cancelled");
    expect(repos.getAppointment(appointment.id)).toEqual({ ...rescheduled, status: "cancelled" });
    expect(await calendar.getEvent(appointment.calendarEventId)).toMatchObject({
      startsAt: new Date("2026-06-02T14:00:00.000Z"),
      status: "cancelled"
    });
  });

  it("allows only one concurrent booking for the same slot", async () => {
    const { service } = buildContext();

    const results = await Promise.allSettled([
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        professionalId: "pro_perez"
      }),
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        professionalId: "pro_perez"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DomainError);
    expect(rejected?.reason.message).toBe("Selected slot is no longer available");
  });

  it("books inside a longer available calendar block", async () => {
    const { service, calendar } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:00:00.000Z") }
    ]);

    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    expect(appointment.endsAt).toEqual(new Date("2026-06-01T13:30:00.000Z"));
  });

  it("applies minimum notice and cancellation notice rules", async () => {
    const { repos, calendar, service } = buildContext(new FakeCalendar(), () => new Date("2026-06-01T12:00:00.000Z"));
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
            restrictions: [],
            professionalIds: ["pro_perez"]
          }
        ],
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        appointmentRules: { minimumNoticeMinutes: 120, cancellationNoticeMinutes: 240, bufferMinutes: 0 },
        requiredPatientFields: ["fullName"]
      })
    );
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-01T15:00:00.000Z"), endsAt: new Date("2026-06-01T15:30:00.000Z") }
    ]);

    await expect(
      service.bookAppointment({
        clinicId: "clinic_1",
        patientId: "pat_1",
        serviceId: "svc_botox",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        professionalId: "pro_perez"
      })
    ).rejects.toThrow("Selected slot is no longer available");

    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T15:00:00.000Z"),
      professionalId: "pro_perez"
    });

    await expect(
      service.cancelAppointment({ clinicId: "clinic_1", appointmentId: appointment.id })
    ).rejects.toThrow(`Appointment ${appointment.id} cannot be cancelled inside the notice window`);
    await expect(
      service.rescheduleAppointment({
        clinicId: "clinic_1",
        appointmentId: appointment.id,
        startsAt: new Date("2026-06-02T15:00:00.000Z")
      })
    ).rejects.toThrow(`Appointment ${appointment.id} cannot be rescheduled inside the notice window`);
  });

  it("blocks calendar time with configured buffer while keeping appointment duration", async () => {
    const { repos, calendar, service } = buildContext();
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
            restrictions: [],
            professionalIds: ["pro_perez"]
          }
        ],
        professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
        appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 15 },
        requiredPatientFields: ["fullName"]
      })
    );
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T14:30:00.000Z") }
    ]);

    const appointment = await service.bookAppointment({
      clinicId: "clinic_1",
      patientId: "pat_1",
      serviceId: "svc_botox",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      professionalId: "pro_perez"
    });

    expect(appointment.endsAt).toEqual(new Date("2026-06-01T13:30:00.000Z"));
    expect(await calendar.getEvent(appointment.calendarEventId)).toMatchObject({
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:45:00.000Z")
    });
  });
});
