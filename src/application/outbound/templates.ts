import type { SendTemplateMessageInput } from "../../ports/messaging.js";

export type OutboundTemplateKind =
  | "reminder_72h"
  | "reminder_24h"
  | "reminder_same_day"
  | "reactivation_1"
  | "reactivation_2"
  | "freed_slot_offer";

type OutboundTemplateParameters = {
  clinicName: string;
  serviceName: string;
  appointmentTimeText?: string;
};

type BuildOutboundTemplateInput = {
  clinicId: string;
  to: string;
  kind: OutboundTemplateKind;
  languageCode?: string;
  parameters: OutboundTemplateParameters;
};

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
    parameters: templateParameters(input.kind, input.parameters)
  };
}

function templateParameters(
  kind: OutboundTemplateKind,
  parameters: OutboundTemplateParameters
): string[] {
  if (kind === "reactivation_1" || kind === "reactivation_2") {
    return [parameters.clinicName, parameters.serviceName];
  }

  return [parameters.clinicName, parameters.serviceName, parameters.appointmentTimeText ?? ""];
}
