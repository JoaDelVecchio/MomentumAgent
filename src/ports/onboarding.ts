import type { Id } from "../domain/types.js";
import type { MaybePromise } from "./repositories.js";

export type ClinicLeadSource = "landing" | "presencial" | "referido" | "outbound";
export type ClinicLeadStatus = "lead" | "converted" | "archived";
export type ClinicLifecycleState = "lead" | "setup" | "ready" | "active" | "paused";
export type ClinicPaymentStatus = "unpaid" | "paid" | "trial" | "waived";

export type ClinicMainPain =
  | "missed_leads"
  | "reception_load"
  | "reactivation"
  | "no_shows"
  | "rescheduling"
  | "other";

export type ClinicLeadInput = {
  contactName: string;
  clinicName: string;
  whatsappOrPhone: string;
  city: string;
  country: string;
  professionalCount: number;
  currentSchedulingSystem: string;
  monthlyWhatsappInquiries: string;
  mainPain: ClinicMainPain;
  source: ClinicLeadSource;
  submittedAt: Date;
};

export type ClinicLeadRecord = ClinicLeadInput & {
  id: Id;
  status: ClinicLeadStatus;
  convertedClinicId?: Id;
  createdAt: Date;
  updatedAt: Date;
};

export type ClinicSetupRecord = {
  clinicId: Id;
  leadId?: Id;
  source: ClinicLeadSource;
  lifecycleState: ClinicLifecycleState;
  paymentStatus: ClinicPaymentStatus;
  primaryContactName: string;
  primaryContactPhone: string;
  city: string;
  country: string;
  whatsappReady: boolean;
  calendarConnected: boolean;
  testConversationPassed: boolean;
  activationChecklistCompleted: boolean;
  createdAt?: Date;
  updatedAt: Date;
};

export type ClinicKnowledgeCategory =
  | "payment_methods"
  | "insurance"
  | "address"
  | "parking"
  | "policy"
  | "other";

export type ClinicKnowledgeRecord = {
  id: Id;
  clinicId: Id;
  category: ClinicKnowledgeCategory;
  question: string;
  answer: string;
  updatedAt: Date;
};

export type ClinicReadiness = {
  clinicId: Id;
  ready: boolean;
  missing: string[];
};

export interface OnboardingRepository {
  createLead(input: ClinicLeadInput): MaybePromise<ClinicLeadRecord>;
  listLeads(): MaybePromise<ClinicLeadRecord[]>;
  getLead(leadId: Id): MaybePromise<ClinicLeadRecord | undefined>;
  markLeadConverted(input: { leadId: Id; clinicId: Id; updatedAt: Date }): MaybePromise<void>;
  upsertClinicSetup(input: ClinicSetupRecord): MaybePromise<ClinicSetupRecord>;
  getClinicSetup(clinicId: Id): MaybePromise<ClinicSetupRecord | undefined>;
  listClinicSetups(): MaybePromise<ClinicSetupRecord[]>;
  updateClinicLifecycle(input: {
    clinicId: Id;
    lifecycleState: ClinicLifecycleState;
    paymentStatus?: ClinicPaymentStatus;
    updatedAt: Date;
  }): MaybePromise<void>;
  updateReadinessFlags(input: {
    clinicId: Id;
    whatsappReady?: boolean;
    calendarConnected?: boolean;
    testConversationPassed?: boolean;
    activationChecklistCompleted?: boolean;
    updatedAt: Date;
  }): MaybePromise<void>;
  upsertClinicKnowledge(input: ClinicKnowledgeRecord): MaybePromise<void>;
  listClinicKnowledge(clinicId: Id): MaybePromise<ClinicKnowledgeRecord[]>;
  isClinicActive(clinicId: Id): MaybePromise<boolean>;
}
