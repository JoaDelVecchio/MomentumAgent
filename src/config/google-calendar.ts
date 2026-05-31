import { optionalEnv, requiredEnv } from "./env.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
] as const;

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  setupToken: string;
  scopes: string[];
};

export function readGoogleCalendarConfig(
  env: NodeJS.ProcessEnv = process.env
): GoogleCalendarConfig {
  const clientId = requiredEnv(env, "GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = requiredEnv(env, "GOOGLE_CALENDAR_CLIENT_SECRET");
  const redirectUri = requiredEnv(env, "GOOGLE_CALENDAR_REDIRECT_URI");
  const setupToken = requiredEnv(env, "GOOGLE_CALENDAR_SETUP_TOKEN");

  try {
    new URL(redirectUri);
  } catch {
    throw new Error("GOOGLE_CALENDAR_REDIRECT_URI must be a valid URL");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    stateSecret: optionalEnv(env.GOOGLE_CALENDAR_OAUTH_STATE_SECRET) ?? clientSecret,
    setupToken,
    scopes: [...GOOGLE_CALENDAR_SCOPES]
  };
}
