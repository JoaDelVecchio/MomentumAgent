import { optionalEnv } from "./env.js";

export type AdminConfig =
  | { enabled: false }
  | { enabled: true; token: string };

export function readAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const token = optionalEnv(env.MOMENTUM_ADMIN_TOKEN);
  if (!token) return { enabled: false };
  return { enabled: true, token };
}
