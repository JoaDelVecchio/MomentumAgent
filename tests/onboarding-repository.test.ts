import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../src/adapters/memory/onboarding-repository.js";

describe("onboarding repository contract", () => {
  it("creates qualified landing leads and lists newest first", async () => {
    const repo = new InMemoryOnboardingRepository();

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
      source: "landing",
      submittedAt: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(first.id).toMatch(/^lead_/);
    await expect(repo.listLeads()).resolves.toEqual([
      expect.objectContaining({ id: second.id, clinicName: "Derma Sur", status: "lead" }),
      expect.objectContaining({ id: first.id, clinicName: "Clinica Norte", status: "lead" })
    ]);
  });

  it("stores clinic setup state, payment status, readiness flags, and knowledge", async () => {
    const repo = new InMemoryOnboardingRepository();
    await repo.upsertClinicSetup({
      clinicId: "clinic_1",
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
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    });
    await repo.upsertClinicKnowledge({
      id: "knowledge_payment",
      clinicId: "clinic_1",
      category: "payment_methods",
      question: "Como se puede pagar?",
      answer: "Aceptamos transferencia, efectivo y tarjeta.",
      updatedAt: new Date("2026-06-01T12:01:00.000Z")
    });

    await repo.updateClinicLifecycle({
      clinicId: "clinic_1",
      lifecycleState: "ready",
      paymentStatus: "paid",
      updatedAt: new Date("2026-06-01T12:02:00.000Z")
    });
    await repo.updateReadinessFlags({
      clinicId: "clinic_1",
      calendarConnected: true,
      whatsappReady: true,
      testConversationPassed: true,
      activationChecklistCompleted: true,
      updatedAt: new Date("2026-06-01T12:03:00.000Z")
    });

    await expect(repo.getClinicSetup("clinic_1")).resolves.toEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        source: "presencial",
        lifecycleState: "ready",
        paymentStatus: "paid",
        calendarConnected: true,
        whatsappReady: true,
        testConversationPassed: true,
        activationChecklistCompleted: true
      })
    );
    await expect(repo.isClinicActive("clinic_1")).resolves.toBe(false);
    await repo.updateClinicLifecycle({
      clinicId: "clinic_1",
      lifecycleState: "active",
      updatedAt: new Date("2026-06-01T12:04:00.000Z")
    });
    await expect(repo.isClinicActive("clinic_1")).resolves.toBe(true);
    await expect(repo.listClinicKnowledge("clinic_1")).resolves.toEqual([
      expect.objectContaining({
        id: "knowledge_payment",
        category: "payment_methods",
        answer: "Aceptamos transferencia, efectivo y tarjeta."
      })
    ]);
  });
});
