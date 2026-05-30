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
