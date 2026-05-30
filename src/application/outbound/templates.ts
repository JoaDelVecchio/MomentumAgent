import type { SendTemplateMessageInput } from "../../ports/messaging.js";

export type OutboundTemplateKind =
  | "reminder_72h"
  | "reminder_24h"
  | "reminder_same_day"
  | "reactivation_1"
  | "reactivation_2"
  | "freed_slot_offer";

type AppointmentTemplateKind =
  | "reminder_72h"
  | "reminder_24h"
  | "reminder_same_day"
  | "freed_slot_offer";

type ReactivationTemplateKind = "reactivation_1" | "reactivation_2";

type AppointmentTemplateParameters = {
  clinicName: string;
  serviceName: string;
  appointmentTimeText: string;
};

type ReactivationTemplateParameters = {
  clinicName: string;
  serviceName: string;
};

type BuildOutboundAppointmentTemplateInput = {
  clinicId: string;
  to: string;
  kind: AppointmentTemplateKind;
  languageCode?: string;
  parameters: AppointmentTemplateParameters;
};

type BuildOutboundReactivationTemplateInput = {
  clinicId: string;
  to: string;
  kind: ReactivationTemplateKind;
  languageCode?: string;
  parameters: ReactivationTemplateParameters;
};

type BuildOutboundTemplateInput =
  | BuildOutboundAppointmentTemplateInput
  | BuildOutboundReactivationTemplateInput;

const templateNames: Record<OutboundTemplateKind, string> = {
  reminder_72h: "appointment_reminder_72h",
  reminder_24h: "appointment_reminder_24h",
  reminder_same_day: "appointment_reminder_same_day",
  reactivation_1: "lead_reactivation_1",
  reactivation_2: "lead_reactivation_2",
  freed_slot_offer: "freed_slot_offer"
};

export function buildOutboundTemplate(input: BuildOutboundTemplateInput): SendTemplateMessageInput {
  return {
    clinicId: input.clinicId,
    to: input.to,
    templateName: templateNames[input.kind],
    languageCode: input.languageCode ?? "es_AR",
    parameters: templateParameters(input)
  };
}

function templateParameters(input: BuildOutboundTemplateInput): string[] {
  switch (input.kind) {
    case "reminder_72h":
    case "reminder_24h":
    case "reminder_same_day":
    case "freed_slot_offer":
      return [
        input.parameters.clinicName,
        input.parameters.serviceName,
        input.parameters.appointmentTimeText
      ];
    case "reactivation_1":
    case "reactivation_2":
      return [input.parameters.clinicName, input.parameters.serviceName];
  }
}
