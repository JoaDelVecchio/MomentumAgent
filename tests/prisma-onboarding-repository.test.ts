import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaOnboardingRepository } from "../src/adapters/prisma/onboarding-repository.js";
import type { ClinicSetupRecord } from "../src/ports/onboarding.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("PrismaOnboardingRepository", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;
  let repo: PrismaOnboardingRepository;

  beforeEach(() => {
    context = createPrismaTestContext("momentum-prisma-onboarding-");
    prisma = context.prisma;
    repo = new PrismaOnboardingRepository(prisma);
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("persists lead capture, lists newest first, returns missing leads as undefined, and converts before setup exists", async () => {
    const first = await repo.createLead({
      contactName: "Ana Manager",
      clinicName: "Clinica Norte",
      whatsappOrPhone: "+5491111111111",
      city: "Buenos Aires",
      country: "Argentina",
      professionalCount: 3,
      currentSchedulingSystem: "Google Calendar",
      monthlyWhatsappInquiries: "200-500",
      mainPain: "missed_leads",
      source: "landing",
      submittedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    const second = await repo.createLead({
      contactName: "Bruno Owner",
      clinicName: "Derma Sur",
      whatsappOrPhone: "+5491122222222",
      city: "Cordoba",
      country: "Argentina",
      professionalCount: 1,
      currentSchedulingSystem: "Outlook",
      monthlyWhatsappInquiries: "50-200",
      mainPain: "reception_load",
      source: "referido",
      submittedAt: new Date("2026-06-02T12:00:00.000Z")
    });

    await expect(repo.listLeads()).resolves.toEqual([
      expect.objectContaining({ id: second.id, clinicName: "Derma Sur", status: "lead" }),
      expect.objectContaining({ id: first.id, clinicName: "Clinica Norte", status: "lead" })
    ]);
    await expect(repo.getLead("missing_lead")).resolves.toBeUndefined();

    await repo.markLeadConverted({
      leadId: first.id,
      clinicId: "clinic_converted_before_setup",
      updatedAt: new Date("2026-06-02T13:00:00.000Z")
    });

    await expect(repo.getLead(first.id)).resolves.toEqual(
      expect.objectContaining({
        id: first.id,
        status: "converted",
        convertedClinicId: "clinic_converted_before_setup",
        updatedAt: new Date("2026-06-02T13:00:00.000Z")
      })
    );
    await expect(
      prisma.clinic.findUnique({
        where: { id: "clinic_converted_before_setup" },
        select: {
          id: true,
          name: true,
          timezone: true,
          requiredPatientFieldsJson: true,
          lifecycleState: true,
          paymentStatus: true
        }
      })
    ).resolves.toEqual({
      id: "clinic_converted_before_setup",
      name: "clinic_converted_before_setup",
      timezone: "America/Argentina/Buenos_Aires",
      requiredPatientFieldsJson: JSON.stringify(["fullName"]),
      lifecycleState: "setup",
      paymentStatus: "unpaid"
    });
  });

  it("upserts clinic setup metadata on Clinic, preserves createdAt, updates mutable fields, and lists newest updated first", async () => {
    const initial = await repo.upsertClinicSetup(setupInput("clinic_setup_a", "2026-06-01T12:00:00.000Z"));
    const second = await repo.upsertClinicSetup({
      ...setupInput("clinic_setup_b", "2026-06-01T12:05:00.000Z"),
      primaryContactName: "Bruno Owner",
      paymentStatus: "trial"
    });
    const updated = await repo.upsertClinicSetup({
      ...setupInput("clinic_setup_a", "2026-06-01T12:10:00.000Z"),
      primaryContactName: "Ana Owner",
      city: "Cordoba"
    });

    expect(initial.createdAt).toBeInstanceOf(Date);
    expect(updated.createdAt).toEqual(initial.createdAt);
    expect(updated.updatedAt).toEqual(new Date("2026-06-01T12:10:00.000Z"));
    await expect(repo.getClinicSetup("clinic_setup_a")).resolves.toEqual(
      expect.objectContaining({
        clinicId: "clinic_setup_a",
        primaryContactName: "Ana Owner",
        city: "Cordoba",
        createdAt: initial.createdAt,
        updatedAt: new Date("2026-06-01T12:10:00.000Z")
      })
    );
    await expect(repo.getClinicSetup("missing_clinic")).resolves.toBeUndefined();
    await expect(repo.listClinicSetups()).resolves.toEqual([
      expect.objectContaining({ clinicId: "clinic_setup_a", updatedAt: new Date("2026-06-01T12:10:00.000Z") }),
      expect.objectContaining({ clinicId: second.clinicId, updatedAt: new Date("2026-06-01T12:05:00.000Z") })
    ]);
  });

  it("updates lifecycle and payment status, no-ops for missing clinics, and preserves createdAt", async () => {
    const initial = await repo.upsertClinicSetup(setupInput("clinic_lifecycle", "2026-06-01T12:00:00.000Z"));

    await repo.updateClinicLifecycle({
      clinicId: "clinic_lifecycle",
      lifecycleState: "ready",
      paymentStatus: "paid",
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });
    await repo.updateClinicLifecycle({
      clinicId: "missing_clinic",
      lifecycleState: "active",
      paymentStatus: "paid",
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });
    await repo.updateClinicLifecycle({
      clinicId: "clinic_lifecycle",
      lifecycleState: "active",
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(repo.getClinicSetup("clinic_lifecycle")).resolves.toEqual(
      expect.objectContaining({
        lifecycleState: "active",
        paymentStatus: "paid",
        createdAt: initial.createdAt,
        updatedAt: new Date("2026-06-01T12:03:00.000Z")
      })
    );
    await expect(repo.getClinicSetup("missing_clinic")).resolves.toBeUndefined();
  });

  it("updates only provided readiness flags and no-ops for missing clinics", async () => {
    await repo.upsertClinicSetup(setupInput("clinic_readiness", "2026-06-01T12:00:00.000Z"));

    await repo.updateReadinessFlags({
      clinicId: "clinic_readiness",
      whatsappReady: true,
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });
    await repo.updateReadinessFlags({
      clinicId: "missing_clinic",
      calendarConnected: true,
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });

    await expect(repo.getClinicSetup("clinic_readiness")).resolves.toEqual(
      expect.objectContaining({
        whatsappReady: true,
        calendarConnected: false,
        testConversationPassed: false,
        activationChecklistCompleted: false,
        updatedAt: new Date("2026-06-01T12:01:00.000Z")
      })
    );
    await expect(repo.getClinicSetup("missing_clinic")).resolves.toBeUndefined();
  });

  it("upserts clinic knowledge and returns clinic rows sorted by category then question", async () => {
    await repo.upsertClinicSetup(setupInput("clinic_knowledge", "2026-06-01T12:00:00.000Z"));
    await repo.upsertClinicKnowledge({
      id: "knowledge_parking_z",
      clinicId: "clinic_knowledge",
      category: "parking",
      question: "Zona de estacionamiento?",
      answer: "Hay estacionamiento medido en la cuadra.",
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_address",
      clinicId: "clinic_knowledge",
      category: "address",
      question: "Donde queda la clinica?",
      answer: "Estamos en Avenida Siempre Viva 123.",
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_parking_z",
      clinicId: "clinic_knowledge",
      category: "parking",
      question: "Zona de estacionamiento?",
      answer: "Hay valet los sabados.",
      updatedAt: new Date("2026-06-01T12:04:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_parking_a",
      clinicId: "clinic_knowledge",
      category: "parking",
      question: "Aceptan bicicletas?",
      answer: "Si, hay bicicletero interno.",
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });

    await expect(repo.listClinicKnowledge("clinic_knowledge")).resolves.toEqual([
      expect.objectContaining({
        id: "knowledge_address",
        category: "address",
        question: "Donde queda la clinica?"
      }),
      expect.objectContaining({
        id: "knowledge_parking_a",
        category: "parking",
        question: "Aceptan bicicletas?"
      }),
      expect.objectContaining({
        id: "knowledge_parking_z",
        category: "parking",
        question: "Zona de estacionamiento?",
        answer: "Hay valet los sabados.",
        updatedAt: new Date("2026-06-01T12:04:00.000Z")
      })
    ]);
  });

  it("requires active lifecycle, eligible payment, and every readiness flag for active clinics", async () => {
    await repo.upsertClinicSetup({
      ...setupInput("clinic_activation", "2026-06-01T12:00:00.000Z"),
      lifecycleState: "active",
      paymentStatus: "paid",
      whatsappReady: true,
      calendarConnected: true,
      testConversationPassed: true,
      activationChecklistCompleted: false
    });

    await expect(repo.isClinicActive("clinic_activation")).resolves.toBe(false);

    await repo.updateReadinessFlags({
      clinicId: "clinic_activation",
      activationChecklistCompleted: true,
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });
    await expect(repo.isClinicActive("clinic_activation")).resolves.toBe(true);

    await repo.updateClinicLifecycle({
      clinicId: "clinic_activation",
      lifecycleState: "paused",
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });
    await expect(repo.isClinicActive("clinic_activation")).resolves.toBe(false);

    await repo.updateClinicLifecycle({
      clinicId: "clinic_activation",
      lifecycleState: "active",
      paymentStatus: "unpaid",
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });
    await expect(repo.isClinicActive("clinic_activation")).resolves.toBe(false);

    for (const paymentStatus of ["trial", "waived"] as const) {
      await repo.updateClinicLifecycle({
        clinicId: "clinic_activation",
        lifecycleState: "active",
        paymentStatus,
        updatedAt: new Date("2026-06-01T12:04:00.000Z")
      });
      await expect(repo.isClinicActive("clinic_activation")).resolves.toBe(true);
    }
  });
});

function setupInput(clinicId: string, updatedAtIso: string): Omit<ClinicSetupRecord, "createdAt"> {
  return {
    clinicId,
    source: "presencial",
    lifecycleState: "setup",
    paymentStatus: "unpaid",
    primaryContactName: "Ana Manager",
    primaryContactPhone: "+5491111111111",
    city: "Buenos Aires",
    country: "Argentina",
    whatsappReady: false,
    calendarConnected: false,
    testConversationPassed: false,
    activationChecklistCompleted: false,
    updatedAt: new Date(updatedAtIso)
  };
}
