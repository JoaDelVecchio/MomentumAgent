import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { Appointment } from "../src/domain/types.js";
import type { Conversation } from "../src/ports/repositories.js";
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

  it("hydrates persisted clinic profiles from a fresh repository instance", async () => {
    const persisted = operationalProfile({
      clinicId: "clinic_hydrate",
      serviceId: "svc_hydrate",
      professionals: [
        { id: "pro_hydrate_a", calendarId: "cal_hydrate_a", name: "Dra. A" },
        { id: "pro_hydrate_b", calendarId: "cal_hydrate_b", name: "Dra. B" }
      ],
      serviceProfessionalIds: ["pro_hydrate_b"]
    });

    await repos.upsertClinicProfile(persisted);

    const freshRepos = new PrismaOperationalRepository(prisma);

    expect(await freshRepos.getClinicProfile("clinic_hydrate")).toEqual({
      ...persisted,
      services: [
        expect.objectContaining({
          id: "svc_hydrate",
          professionalIds: ["pro_hydrate_b"]
        })
      ],
      professionals: [
        {
          id: "pro_hydrate_b",
          name: "Dra. B",
          calendarId: "cal_hydrate_b",
          workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
        }
      ]
    });
  });

  it("returns undefined for minimal clinic rows without services or professionals", async () => {
    await prisma.clinic.create({
      data: {
        id: "clinic_minimal_only",
        name: "Clinica Minimal",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });

    await expect(new PrismaOperationalRepository(prisma).getClinicProfile("clinic_minimal_only")).resolves.toBeUndefined();
  });

  it("removes stale services and professionals without dependencies when a profile is replaced", async () => {
    await repos.upsertClinicProfile(profileWithServices("clinic_prune", ["svc_keep", "svc_stale"], ["pro_keep", "pro_stale"]));
    await repos.upsertClinicProfile(profileWithServices("clinic_prune", ["svc_keep"], ["pro_keep"]));

    await expect(new PrismaOperationalRepository(prisma).getClinicProfile("clinic_prune")).resolves.toEqual(
      expect.objectContaining({
        services: [expect.objectContaining({ id: "svc_keep", professionalIds: ["pro_keep"] })],
        professionals: [expect.objectContaining({ id: "pro_keep" })]
      })
    );
    await expect(
      prisma.service.findMany({
        where: { clinicId: "clinic_prune" },
        orderBy: { id: "asc" },
        select: { id: true }
      })
    ).resolves.toEqual([{ id: "svc_keep" }]);
    await expect(
      prisma.professional.findMany({
        where: { clinicId: "clinic_prune" },
        orderBy: { id: "asc" },
        select: { id: true }
      })
    ).resolves.toEqual([{ id: "pro_keep" }]);
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
        slotLockId: "slotlock_pending",
        slotLockExpiresAt: new Date("2026-05-29T12:10:00.000Z"),
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
    expect(await repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).toEqual(
      expect.objectContaining({
        id: "conv_1",
        clinicId: "clinic_1",
        patientId: "pat_1",
        botPaused: true,
        pendingBooking: {
          slotLockId: "slotlock_pending",
          slotLockExpiresAt: new Date("2026-05-29T12:10:00.000Z"),
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          startsAt: new Date("2026-06-01T13:00:00.000Z"),
          endsAt: new Date("2026-06-01T13:30:00.000Z")
        }
      })
    );
  });

  it("keeps same conversation ids independent across clinics", async () => {
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_conv_a",
        serviceId: "svc_conv",
        professionals: [{ id: "pro_conv", calendarId: "cal_conv_a" }]
      })
    );
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_conv_b",
        serviceId: "svc_conv",
        professionals: [{ id: "pro_conv", calendarId: "cal_conv_b" }]
      })
    );
    await repos.upsertPatient({ id: "pat_conv_a", whatsappNumber: "+5491111112233" });
    await repos.upsertPatient({ id: "pat_conv_b", whatsappNumber: "+5491111112234" });

    await repos.saveConversation({
      id: "conv_shared",
      clinicId: "clinic_conv_a",
      patientId: "pat_conv_a",
      botPaused: false,
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:00:00.000Z")
    });
    await repos.saveConversation({
      id: "conv_shared",
      clinicId: "clinic_conv_b",
      patientId: "pat_conv_b",
      botPaused: true,
      createdAt: new Date("2026-05-29T12:00:00.000Z"),
      updatedAt: new Date("2026-05-29T12:05:00.000Z")
    });

    await expect(
      repos.getConversation({ clinicId: "clinic_conv_a", conversationId: "conv_shared" })
    ).resolves.toEqual(expect.objectContaining({ clinicId: "clinic_conv_a", patientId: "pat_conv_a", botPaused: false }));
    await expect(
      repos.getConversation({ clinicId: "clinic_conv_b", conversationId: "conv_shared" })
    ).resolves.toEqual(expect.objectContaining({ clinicId: "clinic_conv_b", patientId: "pat_conv_b", botPaused: true }));
  });

  it("persists opt-out state by WhatsApp number", async () => {
    await repos.upsertPatient({ id: "pat_opt_out", whatsappNumber: "+5491111112222" });
    await repos.markOptOut("+5491111112222");

    expect(await repos.isOptedOut("+5491111112222")).toBe(true);
    expect(await repos.isOptedOut("+5491111113333")).toBe(false);
  });

  it("persists opt-out state before a patient exists", async () => {
    await repos.markOptOut("+5491111119999");

    const freshRepos = new PrismaOperationalRepository(prisma);

    expect(await freshRepos.isOptedOut("+5491111119999")).toBe(true);
    await freshRepos.upsertPatient({ id: "pat_late_opt_out", whatsappNumber: "+5491111119999" });
    expect(await freshRepos.isOptedOut("+5491111119999")).toBe(true);
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

  it("keeps the appointment calendar id when professional calendar mapping changes", async () => {
    await repos.upsertPatient({ id: "pat_calendar", whatsappNumber: "+5491111114455" });
    await repos.saveAppointment({
      id: "appt_calendar",
      clinicId: "clinic_1",
      patientId: "pat_calendar",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarEventId: "google_evt_calendar",
      calendarId: "cal_perez_original",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      status: "scheduled"
    });
    await repos.upsertClinicProfile(
      operationalProfile({
        clinicId: "clinic_1",
        serviceId: "svc_botox",
        professionals: [{ id: "pro_perez", calendarId: "cal_perez_new" }]
      })
    );

    expect(await repos.getAppointment("appt_calendar")).toEqual(
      expect.objectContaining({ id: "appt_calendar", calendarId: "cal_perez_original" })
    );
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

  it("claims, lists, releases, and consumes slot locks", async () => {
    const lock = await repos.claimSlotLock({
      clinicId: "clinic_1",
      conversationId: "conv_lock_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      expiresAt: new Date("2026-06-01T13:10:00.000Z"),
      now: new Date("2026-06-01T13:00:00.000Z")
    });

    expect(lock).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^slotlock_[0-9a-f-]{36}$/u),
        clinicId: "clinic_1",
        conversationId: "conv_lock_1",
        status: "active"
      })
    );
    await expect(
      repos.claimSlotLock({
        clinicId: "clinic_1",
        conversationId: "conv_lock_2",
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z"),
        expiresAt: new Date("2026-06-01T13:10:00.000Z"),
        now: new Date("2026-06-01T13:00:00.000Z")
      })
    ).resolves.toBeUndefined();
    await expect(
      repos.listActiveSlotLocks({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T13:00:00.000Z"),
        to: new Date("2026-06-01T13:30:00.000Z"),
        now: new Date("2026-06-01T13:00:00.000Z")
      })
    ).resolves.toEqual([expect.objectContaining({ id: lock?.id, status: "active" })]);

    await repos.releaseSlotLock({ lockId: lock!.id, now: new Date("2026-06-01T13:01:00.000Z") });
    await expect(
      repos.listActiveSlotLocks({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T13:00:00.000Z"),
        to: new Date("2026-06-01T13:30:00.000Z"),
        now: new Date("2026-06-01T13:01:00.000Z")
      })
    ).resolves.toEqual([]);

    const nextLock = await repos.claimSlotLock({
      clinicId: "clinic_1",
      conversationId: "conv_lock_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T14:00:00.000Z"),
      endsAt: new Date("2026-06-01T14:30:00.000Z"),
      expiresAt: new Date("2026-06-01T14:10:00.000Z"),
      now: new Date("2026-06-01T14:00:00.000Z")
    });
    await repos.consumeSlotLock({ lockId: nextLock!.id, now: new Date("2026-06-01T14:01:00.000Z") });
    await expect(
      repos.listActiveSlotLocks({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T14:00:00.000Z"),
        to: new Date("2026-06-01T14:30:00.000Z"),
        now: new Date("2026-06-01T14:01:00.000Z")
      })
    ).resolves.toEqual([]);
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

describe("PrismaOperationalRepository outbound persistence", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repos: PrismaOperationalRepository;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-outbound-");
    prisma = context.prisma;
    repos = new PrismaOperationalRepository(prisma);
    await repos.upsertClinicProfile(demoProfile());
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("creates a durable outbound delivery and returns existing for the same key", async () => {
    await repos.upsertPatient({ id: "pat_outbound", whatsappNumber: "+5491111114444" });
    await repos.saveConversation(outboundConversation());
    await repos.saveAppointment(outboundAppointment());

    const now = new Date("2026-05-30T12:00:00.000Z");
    const first = await repos.claimOutboundDelivery({
      key: "reminder:appt_outbound:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111114444",
      patientId: "pat_outbound",
      conversationId: "conv_outbound",
      appointmentId: "appt_outbound",
      templateName: "appointment_reminder_24h",
      metadata: { timezone: "America/Argentina/Buenos_Aires", leadTime: "24h" },
      now
    });
    const freshRepos = new PrismaOperationalRepository(prisma);
    const duplicate = await freshRepos.claimOutboundDelivery({
      key: "reminder:appt_outbound:24h",
      clinicId: "clinic_1",
      automationType: "reminder",
      toWhatsappNumber: "+5491111114444",
      patientId: "pat_outbound",
      conversationId: "conv_outbound",
      appointmentId: "appt_outbound",
      templateName: "appointment_reminder_24h",
      metadata: { timezone: "mutated" },
      now: new Date("2026-05-30T13:00:00.000Z")
    });

    expect(first.kind).toBe("new");
    expect(first.delivery).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^outbound_[0-9a-f-]{36}$/u),
        key: "reminder:appt_outbound:24h",
        clinicId: "clinic_1",
        automationType: "reminder",
        status: "claimed",
        toWhatsappNumber: "+5491111114444",
        patientId: "pat_outbound",
        conversationId: "conv_outbound",
        appointmentId: "appt_outbound",
        templateName: "appointment_reminder_24h",
        metadata: { timezone: "America/Argentina/Buenos_Aires", leadTime: "24h" },
        claimedAt: now,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      })
    );
    expect(duplicate).toEqual({ kind: "existing", delivery: first.delivery });
  });

  it("persists sent status, provider message id, sent timestamp, and metadata", async () => {
    const key = "reminder:appt_outbound:sent";
    const sentAt = new Date("2026-05-30T12:05:00.000Z");

    await claimPrismaOutboundDelivery(repos, { key });
    await repos.markOutboundDeliverySent({ key, providerMessageId: "wamid.outbound.1", sentAt });

    const freshRepos = new PrismaOperationalRepository(prisma);
    expect(await freshRepos.getOutboundDelivery(key)).toEqual(
      expect.objectContaining({
        key,
        status: "sent",
        providerMessageId: "wamid.outbound.1",
        sentAt,
        metadata: { timezone: "America/Argentina/Buenos_Aires", leadTime: "24h" },
        updatedAt: sentAt
      })
    );
  });

  it("lists scheduled appointments for the clinic and time window", async () => {
    await repos.upsertPatient({ id: "pat_outbound_window", whatsappNumber: "+5491111114445" });
    await repos.saveAppointment(
      outboundAppointment({
        id: "appt_outbound",
        patientId: "pat_outbound_window",
        calendarEventId: "google_evt_outbound",
        startsAt: new Date("2026-06-01T13:00:00.000Z")
      })
    );
    await repos.saveAppointment(
      outboundAppointment({
        id: "appt_outbound_later",
        patientId: "pat_outbound_window",
        calendarEventId: "google_evt_outbound_later",
        startsAt: new Date("2026-06-01T14:00:00.000Z")
      })
    );
    await repos.saveAppointment(
      outboundAppointment({
        id: "appt_outbound_cancelled",
        patientId: "pat_outbound_window",
        calendarEventId: "google_evt_outbound_cancelled",
        status: "cancelled",
        startsAt: new Date("2026-06-01T13:30:00.000Z")
      })
    );

    expect(
      await repos.listScheduledAppointments({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T13:00:00.000Z"),
        to: new Date("2026-06-01T14:00:00.000Z")
      })
    ).toEqual([
      expect.objectContaining({ id: "appt_outbound", startsAt: new Date("2026-06-01T13:00:00.000Z") }),
      expect.objectContaining({ id: "appt_outbound_later", startsAt: new Date("2026-06-01T14:00:00.000Z") })
    ]);
  });

  it("lists conversations by clinic and by patient", async () => {
    await repos.upsertPatient({ id: "pat_outbound", whatsappNumber: "+5491111114444" });
    await repos.saveConversation(outboundConversation());

    expect(await repos.listConversationsByClinic("clinic_1")).toContainEqual(
      expect.objectContaining({ id: "conv_outbound", clinicId: "clinic_1", patientId: "pat_outbound" })
    );
    expect(await repos.listConversationsByPatient({ clinicId: "clinic_1", patientId: "pat_outbound" })).toEqual([
      expect.objectContaining({ id: "conv_outbound", clinicId: "clinic_1", patientId: "pat_outbound" })
    ]);
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

function outboundConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_outbound",
    clinicId: "clinic_1",
    patientId: "pat_outbound",
    botPaused: false,
    createdAt: new Date("2026-05-30T11:00:00.000Z"),
    updatedAt: new Date("2026-05-30T11:30:00.000Z"),
    ...overrides
  };
}

function outboundAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const startsAt = overrides.startsAt ?? new Date("2026-06-01T13:00:00.000Z");
  return {
    id: "appt_outbound",
    clinicId: "clinic_1",
    patientId: "pat_outbound",
    serviceId: "svc_botox",
    professionalId: "pro_perez",
    calendarEventId: "google_evt_outbound",
    calendarId: "cal_perez",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    status: "scheduled" as const,
    ...overrides
  };
}

function claimPrismaOutboundDelivery(repos: PrismaOperationalRepository, overrides: { key?: string } = {}) {
  return repos.claimOutboundDelivery({
    key: overrides.key ?? "reminder:appt_outbound:24h",
    clinicId: "clinic_1",
    automationType: "reminder",
    toWhatsappNumber: "+5491111114444",
    patientId: "pat_outbound",
    conversationId: "conv_outbound",
    appointmentId: "appt_outbound",
    templateName: "appointment_reminder_24h",
    metadata: { timezone: "America/Argentina/Buenos_Aires", leadTime: "24h" },
    now: new Date("2026-05-30T12:00:00.000Z")
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

function profileWithServices(clinicId: string, serviceIds: string[], professionalIds: string[]) {
  return parseClinicProfile({
    clinicId,
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: serviceIds.map((serviceId) => ({
      id: serviceId,
      name: serviceId === "svc_keep" ? "Botox" : "Peeling",
      durationMinutes: 30,
      priceText: "Desde $120.000",
      preparation: "Evitar alcohol 24 horas antes.",
      restrictions: ["Momentum no brinda diagnostico medico por WhatsApp."],
      professionalIds
    })),
    professionals: professionalIds.map((professionalId) => ({
      id: professionalId,
      name: professionalId === "pro_keep" ? "Dra. Perez" : "Dra. Gomez",
      calendarId: `${professionalId}_calendar`,
      workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
    })),
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}
