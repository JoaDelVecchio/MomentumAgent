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
  const clientId = readRequiredEnv(env, "GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = readRequiredEnv(env, "GOOGLE_CALENDAR_CLIENT_SECRET");
  const redirectUri = readRequiredEnv(env, "GOOGLE_CALENDAR_REDIRECT_URI");
  const setupToken = readRequiredEnv(env, "GOOGLE_CALENDAR_SETUP_TOKEN");

  try {
    new URL(redirectUri);
  } catch {
    throw new Error("GOOGLE_CALENDAR_REDIRECT_URI must be a valid URL");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    stateSecret: env.GOOGLE_CALENDAR_OAUTH_STATE_SECRET?.trim() || clientSecret,
    setupToken,
    scopes: [...GOOGLE_CALENDAR_SCOPES]
  };
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
