import { optionalEnv } from "./env.js";

export type OutboundConfig =
  | { enabled: false }
  | { enabled: true; token: string };

export function readOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  const token = optionalEnv(env.OUTBOUND_AUTOMATION_TOKEN);
  if (!token) return { enabled: false };
  return { enabled: true, token };
}
