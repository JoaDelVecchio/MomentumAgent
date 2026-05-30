import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("Prisma operational persistence schema", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-operational-schema-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("stores processed webhook deliveries with provider-scoped uniqueness", async () => {
    await prisma.clinic.create({
      data: {
        id: "clinic_1",
        name: "Clinica Demo",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });

    await prisma.processedWebhookDelivery.create({
      data: {
        provider: "kapso",
        idempotencyKey: "delivery_1",
        clinicId: "clinic_1",
        conversationId: "conv_1",
        providerMessageId: "wamid.1"
      }
    });

    await expect(
      prisma.processedWebhookDelivery.create({
        data: {
          provider: "kapso",
          idempotencyKey: "delivery_1",
          clinicId: "clinic_1"
        }
      })
    ).rejects.toThrow();
  });
});

describe("PrismaAuditLog", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-audit-");
    prisma = context.prisma;
    await prisma.clinic.create({
      data: {
        id: "clinic_audit",
        name: "Audit Clinic",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("records audit events and parses metadata on return", async () => {
    const audit = new PrismaAuditLog(prisma);

    const event = await audit.record({
      clinicId: "clinic_audit",
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: { idempotencyKey: "delivery_1", provider: "kapso" }
    });

    expect(event).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        clinicId: "clinic_audit",
        type: "whatsapp.inbound.accepted",
        message: "Accepted WhatsApp inbound delivery",
        metadata: { idempotencyKey: "delivery_1", provider: "kapso" },
        createdAt: expect.any(Date)
      })
    );
  });

  it("records conversation-scoped events before the conversation exists", async () => {
    const audit = new PrismaAuditLog(prisma);

    const event = await audit.record({
      clinicId: "clinic_audit",
      conversationId: "conv_not_persisted_yet",
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: { idempotencyKey: "delivery_early" }
    });

    expect(event).toEqual(
      expect.objectContaining({
        clinicId: "clinic_audit",
        conversationId: "conv_not_persisted_yet",
        metadata: { idempotencyKey: "delivery_early" }
      })
    );
  });
});

describe("PrismaOperationalRepository core state", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repos: PrismaOperationalRepository;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-repos-core-");
    prisma = context.prisma;
    repos = new PrismaOperationalRepository(prisma);
    await repos.upsertClinicProfile(demoProfile());
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("round-trips seeded clinic profile from the process profile cache", async () => {
    expect(await repos.getClinicProfile("clinic_1")).toEqual(demoProfile());
  });

  it("persists same service and professional ids independently per clinic", async () => {
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_shared_a",
        serviceId: "svc_shared",
        professionals: [{ id: "pro_shared", calendarId: "cal_shared_a" }]
      })
    );
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_shared_b",
        serviceId: "svc_shared",
        professionals: [{ id: "pro_shared", calendarId: "cal_shared_b" }]
      })
    );

    await expect(
      prisma.service.findMany({
        where: { id: "svc_shared" },
        orderBy: { clinicId: "asc" },
        select: { clinicId: true, id: true }
      })
    ).resolves.toEqual([
      { clinicId: "clinic_shared_a", id: "svc_shared" },
      { clinicId: "clinic_shared_b", id: "svc_shared" }
    ]);
    await expect(
      prisma.professional.findMany({
        where: { id: "pro_shared" },
        orderBy: { clinicId: "asc" },
        select: { clinicId: true, id: true }
      })
    ).resolves.toEqual([
      { clinicId: "clinic_shared_a", id: "pro_shared" },
      { clinicId: "clinic_shared_b", id: "pro_shared" }
    ]);
  });

  it("syncs service-professional links when a clinic profile changes", async () => {
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_links",
        serviceId: "svc_links",
        professionals: [
          { id: "pro_links_a", calendarId: "cal_links_a" },
          { id: "pro_links_b", calendarId: "cal_links_b" }
        ]
      })
    );
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_links",
        serviceId: "svc_links",
        serviceProfessionalIds: ["pro_links_a"],
        professionals: [
          { id: "pro_links_a", calendarId: "cal_links_a" },
          { id: "pro_links_b", calendarId: "cal_links_b" }
        ]
      })
    );

    await expect(
      prisma.serviceProfessional.findMany({
        where: { clinicId: "clinic_links", serviceId: "svc_links" },
        orderBy: { professionalId: "asc" },
        select: { professionalId: true }
      })
    ).resolves.toEqual([{ professionalId: "pro_links_a" }]);
  });

  it("does not update the profile cache when profile database sync fails", async () => {
    const persisted = operationalProfile({
      clinicId: "clinic_cache",
      serviceId: "svc_cache",
      professionals: [{ id: "pro_cache_a", calendarId: "cal_cache_a" }]
    });
    const invalid = operationalProfile({
      clinicId: "clinic_cache",
      serviceId: "svc_cache",
      professionals: [
        { id: "pro_cache_a", calendarId: "cal_cache_duplicate" },
        { id: "pro_cache_b", calendarId: "cal_cache_duplicate" }
      ]
    });

    await repos.upsertClinicProfile(persisted);
    await expect(repos.upsertClinicProfile(invalid)).rejects.toThrow();

    expect(await repos.getClinicProfile("clinic_cache")).toEqual(persisted);
  });

  it("round-trips patients and conversations with pending booking", async () => {
    await repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    await repos.saveConversation({
      id: "conv_1",
      clinicId: "clinic_1",
      patientId: "pat_1",
      botPaused: true,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:05:00.000Z")
    });

    expect(await repos.getPatient("pat_1")).toEqual({
      id: "pat_1",
      whatsappNumber: "+5491111111111",
      fullName: "Ana Gomez"
    });
    expect(await repos.getConversation("conv_1")).toEqual(
      expect.objectContaining({
        id: "conv_1",
        clinicId: "clinic_1",
        patientId: "pat_1",
        botPaused: true,
        pendingBooking: {
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          startsAt: new Date("2026-06-01T13:00:00.000Z"),
          endsAt: new Date("2026-06-01T13:30:00.000Z")
        }
      })
    );
  });

  it("persists opt-out state by WhatsApp number", async () => {
    await repos.upsertPatient({ id: "pat_opt_out", whatsappNumber: "+5491111112222" });
    await repos.markOptOut("+5491111112222");

    expect(await repos.isOptedOut("+5491111112222")).toBe(true);
    expect(await repos.isOptedOut("+5491111113333")).toBe(false);
  });

  it("persists webhook idempotency across repository instances", async () => {
    await repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: "delivery_1",
      clinicId: "clinic_1",
      conversationId: "conv_1",
      providerMessageId: "wamid.1"
    });
    await repos.markProcessedWebhookDelivery({
      provider: "kapso",
      idempotencyKey: "delivery_1",
      clinicId: "clinic_1",
      conversationId: "conv_1",
      providerMessageId: "wamid.1"
    });

    const freshRepos = new PrismaOperationalRepository(prisma);
    expect(await freshRepos.hasProcessedWebhookDelivery("delivery_1")).toBe(true);
  });

  it("generates process-independent appointment ids", async () => {
    const id = await repos.nextAppointmentId();
    expect(id).toMatch(/^appt_[0-9a-f-]{36}$/u);
  });

  it("round-trips appointments by id and patient", async () => {
    await repos.upsertPatient({ id: "pat_appt", whatsappNumber: "+5491111114444" });
    await repos.saveAppointment({
      id: "appt_1",
      clinicId: "clinic_1",
      patientId: "pat_appt",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "google_evt_1",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      status: "scheduled"
    });

    expect(await repos.getAppointment("appt_1")).toEqual({
      id: "appt_1",
      clinicId: "clinic_1",
      patientId: "pat_appt",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "google_evt_1",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      status: "scheduled"
    });
    expect(await repos.listAppointmentsByPatient("pat_appt")).toEqual([
      expect.objectContaining({ id: "appt_1", status: "scheduled" })
    ]);
  });

  it("round-trips active patient interests", async () => {
    await repos.upsertPatient({ id: "pat_interest", whatsappNumber: "+5491111115555" });
    await repos.saveInterest({
      id: "interest_1",
      clinicId: "clinic_1",
      patientId: "pat_interest",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      preferredFrom: new Date("2026-06-01T12:00:00.000Z"),
      preferredTo: new Date("2026-06-01T16:00:00.000Z"),
      status: "active"
    });
    await repos.saveInterest({
      id: "interest_2",
      clinicId: "clinic_1",
      patientId: "pat_interest",
      serviceId: "svc_botox",
      preferredFrom: new Date("2026-06-02T12:00:00.000Z"),
      preferredTo: new Date("2026-06-02T16:00:00.000Z"),
      status: "fulfilled"
    });

    expect(await repos.listActiveInterests()).toEqual([
      expect.objectContaining({ id: "interest_1", professionalId: "pro_perez", status: "active" })
    ]);
  });

  it("serializes appointment lock operations in process", async () => {
    const events: string[] = [];

    await Promise.all([
      repos.withAppointmentLock("appt_lock", async () => {
        events.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("first:end");
      }),
      repos.withAppointmentLock("appt_lock", async () => {
        events.push("second:start");
        events.push("second:end");
      })
    ]);

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});

function demoProfile() {
  return parseClinicProfile({
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
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function operationalProfile(input: {
  clinicId: string;
  serviceId: string;
  professionals: Array<{ id: string; calendarId: string; name?: string }>;
  serviceProfessionalIds?: string[];
}) {
  return parseClinicProfile({
    clinicId: input.clinicId,
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: input.serviceId,
        name: "Botox",
        durationMinutes: 30,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
        professionalIds: input.serviceProfessionalIds ?? input.professionals.map((professional) => professional.id)
      }
    ],
    professionals: input.professionals.map((professional) => ({
      id: professional.id,
      name: professional.name ?? "Dra. Demo",
      calendarId: professional.calendarId,
      workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
    })),
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
