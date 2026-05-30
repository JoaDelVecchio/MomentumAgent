export type LeadMainPain =
  | "missed_leads"
  | "reception_load"
  | "reactivation"
  | "no_shows"
  | "rescheduling"
  | "other";

export type ClinicLeadPayload = {
  contactName: string;
  clinicName: string;
  whatsappOrPhone: string;
  city: string;
  country: string;
  professionalCount: number;
  currentSchedulingSystem: string;
  monthlyWhatsappInquiries: string;
  mainPain: LeadMainPain;
};

export type ClinicLeadResponse = {
  lead: ClinicLeadPayload & {
    id: string;
    status: "lead" | "converted" | "archived";
    source: "landing" | "presencial" | "referido" | "outbound";
    submittedAt: string;
    createdAt: string;
    updatedAt: string;
    convertedClinicId?: string;
  };
};

export type ClinicLeadSource = "landing" | "presencial" | "referido" | "outbound";
export type ClinicLeadStatus = "lead" | "converted" | "archived";
export type ClinicLifecycleState = "lead" | "setup" | "ready" | "active" | "paused";
export type ClinicPaymentStatus = "unpaid" | "paid" | "trial" | "waived";

export type ClinicLeadRecord = ClinicLeadPayload & {
  id: string;
  status: ClinicLeadStatus;
  source: ClinicLeadSource;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  convertedClinicId?: string;
};

export type ClinicSetupRecord = {
  clinicId: string;
  leadId?: string;
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
  createdAt: string;
  updatedAt: string;
};

export type ManualClinicPayload = {
  clinicId: string;
  clinicName: string;
  primaryContactName: string;
  primaryContactPhone: string;
  city: string;
  country: string;
  source: ClinicLeadSource;
};

export type LeadsResponse = {
  leads: ClinicLeadRecord[];
};

export type ClinicsResponse = {
  clinics: ClinicSetupRecord[];
};

export type ClinicSetupResponse = {
  setup: ClinicSetupRecord;
};

export type ClinicReadinessKey =
  | "clinic_profile"
  | "payment"
  | "whatsapp"
  | "calendar"
  | "test_conversation"
  | "activation_checklist"
  | string;

export type ActivationErrorResponse = {
  error: "clinic_not_ready" | "not_found" | "unauthorized" | string;
  missing?: ClinicReadinessKey[];
};

export type TestMessageResponse = {
  result: {
    kind: string;
    text?: string;
    [key: string]: unknown;
  };
};
