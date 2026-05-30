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
    };

export function readWhatsAppConfig(env: NodeJS.ProcessEnv): WhatsAppConfig {
  const provider = env.WHATSAPP_PROVIDER;
  if (!provider) {
    return { provider: "disabled" };
  }
  if (provider !== "kapso") {
    throw new Error(`Unsupported WHATSAPP_PROVIDER: ${provider}`);
  }

  return {
    provider: "kapso",
    apiKey: requireEnv(env, "KAPSO_API_KEY"),
    webhookSecret: requireEnv(env, "KAPSO_WEBHOOK_SECRET"),
    phoneNumberId: requireEnv(env, "KAPSO_PHONE_NUMBER_ID"),
    businessAccountId: env.KAPSO_BUSINESS_ACCOUNT_ID,
    publicWebhookUrl: env.MOMENTUM_PUBLIC_WEBHOOK_URL
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required when WHATSAPP_PROVIDER=kapso`);
  }
  return value;
}
