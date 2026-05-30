import type { ClinicProfile, Id } from "../../domain/types.js";
import type {
  ClinicKnowledgeRecord,
  ClinicLeadInput,
  ClinicLeadRecord,
  ClinicLeadSource,
  ClinicPaymentStatus,
  ClinicReadiness,
  ClinicSetupRecord,
  OnboardingRepository
} from "../../ports/onboarding.js";
import type { OperationalRepository } from "../../ports/repositories.js";

export type OnboardingServiceOptions = {
  onboarding: OnboardingRepository;
  operational: OperationalRepository;
  now?: () => Date;
};

export type SubmitLeadInput = Omit<ClinicLeadInput, "source" | "submittedAt">;

export type CreateManualClinicInput = {
  clinicId: Id;
  clinicName: string;
  primaryContactName: string;
  primaryContactPhone: string;
  city: string;
  country: string;
  source: ClinicLeadSource;
  now?: Date;
};

export type ConvertLeadToClinicInput = {
  leadId: Id;
  clinicId: Id;
  now?: Date;
};

export type UpdatePaymentStatusInput = {
  clinicId: Id;
  paymentStatus: ClinicPaymentStatus;
  now?: Date;
};

export type UpdateReadinessFlagsInput = {
  clinicId: Id;
  whatsappReady?: boolean;
  calendarConnected?: boolean;
  testConversationPassed?: boolean;
  activationChecklistCompleted?: boolean;
  now?: Date;
};

export type ClinicLifecycleInput = {
  clinicId: Id;
  now?: Date;
};

export class OnboardingService {
  constructor(private readonly options: OnboardingServiceOptions) {}

  async submitLead(input: SubmitLeadInput): Promise<ClinicLeadRecord> {
    return this.options.onboarding.createLead({
      ...input,
      source: "landing",
      submittedAt: this.currentDate()
    });
  }

  async createManualClinic(input: CreateManualClinicInput): Promise<ClinicSetupRecord> {
    return this.options.onboarding.upsertClinicSetup({
      clinicId: input.clinicId,
      source: input.source,
      lifecycleState: "setup",
      paymentStatus: "unpaid",
      primaryContactName: input.primaryContactName,
      primaryContactPhone: input.primaryContactPhone,
      city: input.city,
      country: input.country,
      whatsappReady: false,
      calendarConnected: false,
      testConversationPassed: false,
      activationChecklistCompleted: false,
      updatedAt: this.currentDate(input.now)
    });
  }

  async convertLeadToClinic(input: ConvertLeadToClinicInput): Promise<ClinicSetupRecord> {
    const lead = await this.options.onboarding.getLead(input.leadId);
    if (!lead) {
      throw new Error(`Clinic lead ${input.leadId} not found`);
    }

    const updatedAt = this.currentDate(input.now);
    const setup = await this.options.onboarding.upsertClinicSetup({
      clinicId: input.clinicId,
      leadId: lead.id,
      source: lead.source,
      lifecycleState: "setup",
      paymentStatus: "unpaid",
      primaryContactName: lead.contactName,
      primaryContactPhone: lead.whatsappOrPhone,
      city: lead.city,
      country: lead.country,
      whatsappReady: false,
      calendarConnected: false,
      testConversationPassed: false,
      activationChecklistCompleted: false,
      updatedAt
    });
    await this.options.onboarding.markLeadConverted({ leadId: lead.id, clinicId: input.clinicId, updatedAt });
    return setup;
  }

  async saveClinicProfile(profile: ClinicProfile): Promise<void> {
    await this.options.operational.upsertClinicProfile(profile);
  }

  async updatePaymentStatus(input: UpdatePaymentStatusInput): Promise<ClinicSetupRecord> {
    const setup = await this.requireSetup(input.clinicId);
    await this.options.onboarding.updateClinicLifecycle({
      clinicId: input.clinicId,
      lifecycleState: setup.lifecycleState,
      paymentStatus: input.paymentStatus,
      updatedAt: this.currentDate(input.now)
    });
    return this.requireSetup(input.clinicId);
  }

  async updateReadinessFlags(input: UpdateReadinessFlagsInput): Promise<ClinicSetupRecord> {
    await this.requireSetup(input.clinicId);
    await this.options.onboarding.updateReadinessFlags({
      clinicId: input.clinicId,
      whatsappReady: input.whatsappReady,
      calendarConnected: input.calendarConnected,
      testConversationPassed: input.testConversationPassed,
      activationChecklistCompleted: input.activationChecklistCompleted,
      updatedAt: this.currentDate(input.now)
    });
    return this.requireSetup(input.clinicId);
  }

  async upsertKnowledge(input: ClinicKnowledgeRecord): Promise<void> {
    await this.options.onboarding.upsertClinicKnowledge(input);
  }

  async readiness(clinicId: Id): Promise<ClinicReadiness> {
    const [setup, profile] = await Promise.all([
      this.options.onboarding.getClinicSetup(clinicId),
      this.options.operational.getClinicProfile(clinicId)
    ]);
    const paymentOk =
      setup?.paymentStatus === "paid" || setup?.paymentStatus === "trial" || setup?.paymentStatus === "waived";
    const missing = [
      !profile ? "clinic_profile" : undefined,
      !paymentOk ? "payment" : undefined,
      !setup?.whatsappReady ? "whatsapp" : undefined,
      !setup?.calendarConnected ? "calendar" : undefined,
      !setup?.testConversationPassed ? "test_conversation" : undefined,
      !setup?.activationChecklistCompleted ? "activation_checklist" : undefined
    ].filter((value): value is string => Boolean(value));

    return { clinicId, ready: missing.length === 0, missing };
  }

  async activateClinic(input: ClinicLifecycleInput): Promise<ClinicSetupRecord> {
    await this.requireSetup(input.clinicId);
    const readiness = await this.readiness(input.clinicId);
    if (!readiness.ready) {
      throw new Error(`Clinic ${input.clinicId} is not ready to activate: ${readiness.missing.join(", ")}`);
    }

    await this.options.onboarding.updateClinicLifecycle({
      clinicId: input.clinicId,
      lifecycleState: "active",
      updatedAt: this.currentDate(input.now)
    });
    return this.requireSetup(input.clinicId);
  }

  async pauseClinic(input: ClinicLifecycleInput): Promise<ClinicSetupRecord> {
    await this.requireSetup(input.clinicId);
    await this.options.onboarding.updateClinicLifecycle({
      clinicId: input.clinicId,
      lifecycleState: "paused",
      updatedAt: this.currentDate(input.now)
    });
    return this.requireSetup(input.clinicId);
  }

  async isClinicActive(clinicId: Id): Promise<boolean> {
    const [active, profile] = await Promise.all([
      this.options.onboarding.isClinicActive(clinicId),
      this.options.operational.getClinicProfile(clinicId)
    ]);
    return active && Boolean(profile);
  }

  private async requireSetup(clinicId: Id): Promise<ClinicSetupRecord> {
    const setup = await this.options.onboarding.getClinicSetup(clinicId);
    if (!setup) {
      throw new Error(`Clinic setup ${clinicId} not found`);
    }
    return setup;
  }

  private currentDate(override?: Date): Date {
    return new Date(override ?? this.options.now?.() ?? new Date());
  }
}
