import type { ClinicProfile, Id } from "../../domain/types.js";
import type { CalendarCredentialRepository, CalendarCredentials } from "../../ports/calendar-auth.js";
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
import {
  googleCalendarConnectionStatus,
  hasUsableProfessionalCalendarMappings
} from "./google-calendar-onboarding-service.js";

export type OnboardingServiceOptions = {
  onboarding: OnboardingRepository;
  operational: OperationalRepository;
  calendarCredentials?: CalendarCredentialRepository;
  calendarRequiredScopes?: string[];
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

  async listLeads(): Promise<ClinicLeadRecord[]> {
    return this.options.onboarding.listLeads();
  }

  async createManualClinic(input: CreateManualClinicInput): Promise<ClinicSetupRecord> {
    return this.options.onboarding.upsertClinicSetup({
      clinicId: input.clinicId,
      clinicName: input.clinicName,
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
      clinicName: lead.clinicName,
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

  async listClinicSetups(): Promise<ClinicSetupRecord[]> {
    return this.options.onboarding.listClinicSetups();
  }

  async getClinicSetup(clinicId: Id): Promise<ClinicSetupRecord | undefined> {
    return this.options.onboarding.getClinicSetup(clinicId);
  }

  async saveClinicProfile(profile: ClinicProfile): Promise<ClinicProfile> {
    await this.options.operational.upsertClinicProfile(profile);
    return profile;
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
    const [setup, profile, googleCredentials] = await Promise.all([
      this.options.onboarding.getClinicSetup(clinicId),
      this.options.operational.getClinicProfile(clinicId),
      this.options.calendarCredentials?.get({ clinicId, provider: "google" })
    ]);
    const paymentOk =
      setup?.paymentStatus === "paid" || setup?.paymentStatus === "trial" || setup?.paymentStatus === "waived";
    const calendarOk = this.isCalendarReady(setup, profile, googleCredentials);
    const missing = [
      !isCompleteOperationalProfile(profile) ? "clinic_profile" : undefined,
      !paymentOk ? "payment" : undefined,
      !setup?.whatsappReady ? "whatsapp" : undefined,
      !calendarOk ? "calendar" : undefined,
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
    return active && isCompleteOperationalProfile(profile);
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

  private isCalendarReady(
    setup: ClinicSetupRecord | undefined,
    profile: ClinicProfile | undefined,
    googleCredentials: CalendarCredentials | undefined
  ): boolean {
    if (!this.options.calendarCredentials) {
      return Boolean(setup?.calendarConnected);
    }
    const status = googleCalendarConnectionStatus({
      credentials: googleCredentials,
      requiredScopes: this.options.calendarRequiredScopes ?? []
    });
    return status.connected && !status.reconnectRequired && hasUsableProfessionalCalendarMappings(profile);
  }
}

function isCompleteOperationalProfile(profile: ClinicProfile | undefined): boolean {
  if (!profile) {
    return false;
  }

  const reservableProfessionalIds = new Set(
    profile.professionals
      .filter((professional) => professional.calendarId.trim().length > 0)
      .map((professional) => professional.id)
  );
  return (
    reservableProfessionalIds.size > 0 &&
    profile.services.some((service) =>
      service.professionalIds.some((professionalId) => reservableProfessionalIds.has(professionalId))
    )
  );
}
