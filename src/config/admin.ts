export type AdminConfig =
  | { enabled: false }
  | { enabled: true; token: string };

export function readAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const token = env.MOMENTUM_ADMIN_TOKEN?.trim();
  if (!token) return { enabled: false };
  return { enabled: true, token };
}
