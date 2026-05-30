export type OutboundConfig =
  | { enabled: false }
  | { enabled: true; token: string };

export function readOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  const token = env.OUTBOUND_AUTOMATION_TOKEN?.trim();
  if (!token) return { enabled: false };
  return { enabled: true, token };
}
