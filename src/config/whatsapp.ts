import { optionalEnv, requiredEnv } from "./env.js";

export type WhatsAppConfig =
  | {
      provider: "disabled";
    }
  | {
      provider: "kapso";
      apiKey: string;
      webhookSecret: string;
      phoneNumberId: string;
      businessAccountId?: string;
      publicWebhookUrl?: string;
      bookingFlowId?: string;
      bookingFlowCta?: string;
      bookingFlowScreen?: string;
    };

export function readWhatsAppConfig(env: NodeJS.ProcessEnv): WhatsAppConfig {
  const provider = optionalEnv(env.WHATSAPP_PROVIDER);
  if (!provider) {
    return { provider: "disabled" };
  }
  if (provider !== "kapso") {
    throw new Error(`Unsupported WHATSAPP_PROVIDER: ${provider}`);
  }

  return {
    provider: "kapso",
    apiKey: requiredEnv(env, "KAPSO_API_KEY", "KAPSO_API_KEY is required when WHATSAPP_PROVIDER=kapso"),
    webhookSecret: requiredEnv(
      env,
      "KAPSO_WEBHOOK_SECRET",
      "KAPSO_WEBHOOK_SECRET is required when WHATSAPP_PROVIDER=kapso"
    ),
    phoneNumberId: requiredEnv(
      env,
      "KAPSO_PHONE_NUMBER_ID",
      "KAPSO_PHONE_NUMBER_ID is required when WHATSAPP_PROVIDER=kapso"
    ),
    businessAccountId: optionalEnv(env.KAPSO_BUSINESS_ACCOUNT_ID),
    publicWebhookUrl: optionalEnv(env.MOMENTUM_PUBLIC_WEBHOOK_URL),
    bookingFlowId: optionalEnv(env.WHATSAPP_BOOKING_FLOW_ID),
    bookingFlowCta: optionalEnv(env.WHATSAPP_BOOKING_FLOW_CTA),
    bookingFlowScreen: optionalEnv(env.WHATSAPP_BOOKING_FLOW_SCREEN)
  };
}
