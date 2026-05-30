import type { Id } from "../../domain/types.js";
import type {
  ClinicKnowledgeRecord,
  ClinicLeadInput,
  ClinicLeadRecord,
  ClinicSetupRecord,
  ClinicSetupUpsertInput,
  OnboardingRepository
} from "../../ports/onboarding.js";

export class InMemoryOnboardingRepository implements OnboardingRepository {
  private leads = new Map<Id, ClinicLeadRecord>();
  private setups = new Map<Id, ClinicSetupRecord>();
  private knowledge = new Map<Id, ClinicKnowledgeRecord>();
  private leadCounter = 0;

  async createLead(input: ClinicLeadInput): Promise<ClinicLeadRecord> {
    this.leadCounter += 1;
    const now = new Date(input.submittedAt);
    const lead: ClinicLeadRecord = {
      ...input,
      id: `lead_${this.leadCounter}`,
      status: "lead",
      submittedAt: new Date(input.submittedAt),
      createdAt: now,
      updatedAt: now
    };
    this.leads.set(lead.id, cloneLead(lead));
    return cloneLead(lead);
  }

  async listLeads(): Promise<ClinicLeadRecord[]> {
    return [...this.leads.values()]
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map(cloneLead);
  }

  async getLead(leadId: Id): Promise<ClinicLeadRecord | undefined> {
    const lead = this.leads.get(leadId);
    return lead ? cloneLead(lead) : undefined;
  }

  async markLeadConverted(input: { leadId: Id; clinicId: Id; updatedAt: Date }): Promise<void> {
    const lead = this.requireLead(input.leadId);
    this.leads.set(input.leadId, {
      ...lead,
      status: "converted",
      convertedClinicId: input.clinicId,
      updatedAt: new Date(input.updatedAt)
    });
  }

  async upsertClinicSetup(input: ClinicSetupUpsertInput): Promise<ClinicSetupRecord> {
    const existing = this.setups.get(input.clinicId);
    const setup: ClinicSetupRecord = {
      ...input,
      createdAt: existing ? new Date(existing.createdAt) : new Date(input.updatedAt),
      updatedAt: new Date(input.updatedAt)
    };
    this.setups.set(input.clinicId, cloneSetup(setup));
    return cloneSetup(setup);
  }

  async getClinicSetup(clinicId: Id): Promise<ClinicSetupRecord | undefined> {
    const setup = this.setups.get(clinicId);
    return setup ? cloneSetup(setup) : undefined;
  }

  async listClinicSetups(): Promise<ClinicSetupRecord[]> {
    return [...this.setups.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneSetup);
  }

  async updateClinicLifecycle(input: {
    clinicId: Id;
    lifecycleState: ClinicSetupRecord["lifecycleState"];
    paymentStatus?: ClinicSetupRecord["paymentStatus"];
    updatedAt: Date;
  }): Promise<void> {
    const setup = this.requireSetup(input.clinicId);
    this.setups.set(input.clinicId, {
      ...setup,
      lifecycleState: input.lifecycleState,
      paymentStatus: input.paymentStatus ?? setup.paymentStatus,
      updatedAt: new Date(input.updatedAt)
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
    const setup = this.requireSetup(input.clinicId);
    this.setups.set(input.clinicId, {
      ...setup,
      whatsappReady: input.whatsappReady ?? setup.whatsappReady,
      calendarConnected: input.calendarConnected ?? setup.calendarConnected,
      testConversationPassed: input.testConversationPassed ?? setup.testConversationPassed,
      activationChecklistCompleted: input.activationChecklistCompleted ?? setup.activationChecklistCompleted,
      updatedAt: new Date(input.updatedAt)
    });
  }

  async upsertClinicKnowledge(input: ClinicKnowledgeRecord): Promise<void> {
    this.knowledge.set(input.id, cloneKnowledge(input));
  }

  async listClinicKnowledge(clinicId: Id): Promise<ClinicKnowledgeRecord[]> {
    return [...this.knowledge.values()]
      .filter((record) => record.clinicId === clinicId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.question.localeCompare(b.question))
      .map(cloneKnowledge);
  }

  async isClinicActive(clinicId: Id): Promise<boolean> {
    return this.setups.get(clinicId)?.lifecycleState === "active";
  }

  private requireLead(leadId: Id) {
    const lead = this.leads.get(leadId);
    if (!lead) {
      throw new Error(`Clinic lead ${leadId} not found`);
    }
    return cloneLead(lead);
  }

  private requireSetup(clinicId: Id) {
    const setup = this.setups.get(clinicId);
    if (!setup) {
      throw new Error(`Clinic setup ${clinicId} not found`);
    }
    return cloneSetup(setup);
  }
}

function cloneLead(lead: ClinicLeadRecord): ClinicLeadRecord {
  return {
    ...lead,
    submittedAt: new Date(lead.submittedAt),
    createdAt: new Date(lead.createdAt),
    updatedAt: new Date(lead.updatedAt)
  };
}

function cloneSetup(setup: ClinicSetupRecord): ClinicSetupRecord {
  return {
    ...setup,
    createdAt: new Date(setup.createdAt),
    updatedAt: new Date(setup.updatedAt)
  };
}

function cloneKnowledge(record: ClinicKnowledgeRecord): ClinicKnowledgeRecord {
  return { ...record, updatedAt: new Date(record.updatedAt) };
}
