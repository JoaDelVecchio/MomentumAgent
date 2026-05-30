import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Id } from "../../domain/types.js";
import type {
  ClinicKnowledgeRecord,
  ClinicLeadRecord,
  ClinicSetupRecord,
  ClinicSetupUpsertInput,
  OnboardingRepository
} from "../../ports/onboarding.js";
import type {
  ClinicKnowledgeCategory,
  ClinicLeadInput,
  ClinicLeadSource,
  ClinicLeadStatus,
  ClinicLifecycleState,
  ClinicMainPain,
  ClinicPaymentStatus
} from "../../ports/onboarding.js";

type ClinicLeadRow = {
  id: string;
  contactName: string;
  clinicName: string;
  whatsappOrPhone: string;
  city: string;
  country: string;
  professionalCount: number;
  currentSchedulingSystem: string;
  monthlyWhatsappInquiries: string;
  mainPain: string;
  source: string;
  status: string;
  convertedClinicId: string | null;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ClinicSetupRow = {
  id: string;
  leadId: string | null;
  source: string;
  lifecycleState: string;
  paymentStatus: string;
  primaryContactName: string;
  primaryContactPhone: string;
  city: string;
  country: string;
  whatsappReady: boolean;
  calendarConnected: boolean;
  testConversationPassed: boolean;
  activationChecklistCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ClinicKnowledgeRow = {
  id: string;
  clinicId: string;
  category: string;
  question: string;
  answer: string;
  updatedAt: Date;
};

const MINIMAL_CLINIC_DEFAULTS = {
  timezone: "America/Argentina/Buenos_Aires",
  minimumNoticeMinutes: 0,
  cancellationNoticeMinutes: 1440,
  bufferMinutes: 0,
  requiredPatientFieldsJson: JSON.stringify(["fullName"])
} as const;

const ACTIVE_PAYMENT_STATUSES = new Set<ClinicPaymentStatus>(["paid", "trial", "waived"]);

export class PrismaOnboardingRepository implements OnboardingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createLead(input: ClinicLeadInput): Promise<ClinicLeadRecord> {
    const lead = await this.prisma.clinicLead.create({
      data: {
        id: `lead_${randomUUID()}`,
        contactName: input.contactName,
        clinicName: input.clinicName,
        whatsappOrPhone: input.whatsappOrPhone,
        city: input.city,
        country: input.country,
        professionalCount: input.professionalCount,
        currentSchedulingSystem: input.currentSchedulingSystem,
        monthlyWhatsappInquiries: input.monthlyWhatsappInquiries,
        mainPain: input.mainPain,
        source: input.source,
        status: "lead",
        submittedAt: input.submittedAt,
        createdAt: input.submittedAt,
        updatedAt: input.submittedAt
      }
    });
    return toLeadRecord(lead);
  }

  async listLeads(): Promise<ClinicLeadRecord[]> {
    const leads = await this.prisma.clinicLead.findMany({
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }]
    });
    return leads.map(toLeadRecord);
  }

  async getLead(leadId: Id): Promise<ClinicLeadRecord | undefined> {
    const lead = await this.prisma.clinicLead.findUnique({ where: { id: leadId } });
    return lead ? toLeadRecord(lead) : undefined;
  }

  async markLeadConverted(input: { leadId: Id; clinicId: Id; updatedAt: Date }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await ensureMinimalClinic(tx, input.clinicId);
      await tx.clinicLead.update({
        where: { id: input.leadId },
        data: {
          status: "converted",
          convertedClinicId: input.clinicId,
          updatedAt: input.updatedAt
        }
      });
    });
  }

  async upsertClinicSetup(input: ClinicSetupUpsertInput): Promise<ClinicSetupRecord> {
    const clinic = await this.prisma.clinic.upsert({
      where: { id: input.clinicId },
      create: {
        id: input.clinicId,
        name: input.clinicId,
        ...MINIMAL_CLINIC_DEFAULTS,
        leadId: input.leadId ?? null,
        source: input.source,
        lifecycleState: input.lifecycleState,
        paymentStatus: input.paymentStatus,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        city: input.city,
        country: input.country,
        whatsappReady: input.whatsappReady,
        calendarConnected: input.calendarConnected,
        testConversationPassed: input.testConversationPassed,
        activationChecklistCompleted: input.activationChecklistCompleted,
        updatedAt: input.updatedAt
      },
      update: {
        leadId: input.leadId ?? null,
        source: input.source,
        lifecycleState: input.lifecycleState,
        paymentStatus: input.paymentStatus,
        primaryContactName: input.primaryContactName,
        primaryContactPhone: input.primaryContactPhone,
        city: input.city,
        country: input.country,
        whatsappReady: input.whatsappReady,
        calendarConnected: input.calendarConnected,
        testConversationPassed: input.testConversationPassed,
        activationChecklistCompleted: input.activationChecklistCompleted,
        updatedAt: input.updatedAt
      }
    });
    return toSetupRecord(clinic);
  }

  async getClinicSetup(clinicId: Id): Promise<ClinicSetupRecord | undefined> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    return clinic ? toSetupRecord(clinic) : undefined;
  }

  async listClinicSetups(): Promise<ClinicSetupRecord[]> {
    const clinics = await this.prisma.clinic.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return clinics.map(toSetupRecord);
  }

  async updateClinicLifecycle(input: {
    clinicId: Id;
    lifecycleState: ClinicLifecycleState;
    paymentStatus?: ClinicPaymentStatus;
    updatedAt: Date;
  }): Promise<void> {
    await this.prisma.clinic.updateMany({
      where: { id: input.clinicId },
      data: {
        lifecycleState: input.lifecycleState,
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
        updatedAt: input.updatedAt
      }
    });
  }

  async updateReadinessFlags(input: {
    clinicId: Id;
    whatsappReady?: boolean;
    calendarConnected?: boolean;
    testConversationPassed?: boolean;
    activationChecklistCompleted?: boolean;
    updatedAt: Date;
  }): Promise<void> {
    await this.prisma.clinic.updateMany({
      where: { id: input.clinicId },
      data: {
        ...(input.whatsappReady === undefined ? {} : { whatsappReady: input.whatsappReady }),
        ...(input.calendarConnected === undefined ? {} : { calendarConnected: input.calendarConnected }),
        ...(input.testConversationPassed === undefined ? {} : { testConversationPassed: input.testConversationPassed }),
        ...(input.activationChecklistCompleted === undefined
          ? {}
          : { activationChecklistCompleted: input.activationChecklistCompleted }),
        updatedAt: input.updatedAt
      }
    });
  }

  async upsertClinicKnowledge(input: ClinicKnowledgeRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await ensureMinimalClinic(tx, input.clinicId);
      await tx.clinicKnowledge.upsert({
        where: { id: input.id },
        create: {
          id: input.id,
          clinicId: input.clinicId,
          category: input.category,
          question: input.question,
          answer: input.answer,
          updatedAt: input.updatedAt
        },
        update: {
          clinicId: input.clinicId,
          category: input.category,
          question: input.question,
          answer: input.answer,
          updatedAt: input.updatedAt
        }
      });
    });
  }

  async listClinicKnowledge(clinicId: Id): Promise<ClinicKnowledgeRecord[]> {
    const rows = await this.prisma.clinicKnowledge.findMany({
      where: { clinicId },
      orderBy: [{ category: "asc" }, { question: "asc" }]
    });
    return rows.map(toKnowledgeRecord);
  }

  async isClinicActive(clinicId: Id): Promise<boolean> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        lifecycleState: true,
        paymentStatus: true,
        whatsappReady: true,
        calendarConnected: true,
        testConversationPassed: true,
        activationChecklistCompleted: true
      }
    });
    return (
      clinic?.lifecycleState === "active" &&
      ACTIVE_PAYMENT_STATUSES.has(clinic.paymentStatus as ClinicPaymentStatus) &&
      clinic.whatsappReady &&
      clinic.calendarConnected &&
      clinic.testConversationPassed &&
      clinic.activationChecklistCompleted
    );
  }
}

function toLeadRecord(row: ClinicLeadRow): ClinicLeadRecord {
  return {
    id: row.id,
    contactName: row.contactName,
    clinicName: row.clinicName,
    whatsappOrPhone: row.whatsappOrPhone,
    city: row.city,
    country: row.country,
    professionalCount: row.professionalCount,
    currentSchedulingSystem: row.currentSchedulingSystem,
    monthlyWhatsappInquiries: row.monthlyWhatsappInquiries,
    mainPain: row.mainPain as ClinicMainPain,
    source: row.source as ClinicLeadSource,
    status: row.status as ClinicLeadStatus,
    ...(row.convertedClinicId ? { convertedClinicId: row.convertedClinicId } : {}),
    submittedAt: new Date(row.submittedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}

function toSetupRecord(row: ClinicSetupRow): ClinicSetupRecord {
  return {
    clinicId: row.id,
    ...(row.leadId ? { leadId: row.leadId } : {}),
    source: row.source as ClinicLeadSource,
    lifecycleState: row.lifecycleState as ClinicLifecycleState,
    paymentStatus: row.paymentStatus as ClinicPaymentStatus,
    primaryContactName: row.primaryContactName,
    primaryContactPhone: row.primaryContactPhone,
    city: row.city,
    country: row.country,
    whatsappReady: row.whatsappReady,
    calendarConnected: row.calendarConnected,
    testConversationPassed: row.testConversationPassed,
    activationChecklistCompleted: row.activationChecklistCompleted,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}

function toKnowledgeRecord(row: ClinicKnowledgeRow): ClinicKnowledgeRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    category: row.category as ClinicKnowledgeCategory,
    question: row.question,
    answer: row.answer,
    updatedAt: new Date(row.updatedAt)
  };
}

async function ensureMinimalClinic(
  prisma: Pick<PrismaClient, "clinic">,
  clinicId: Id
): Promise<void> {
  await prisma.clinic.upsert({
    where: { id: clinicId },
    create: {
      id: clinicId,
      name: clinicId,
      ...MINIMAL_CLINIC_DEFAULTS
    },
    update: {}
  });
}
