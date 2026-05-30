import type {
  CalendarCredentialRepository,
  CalendarCredentials
} from "../../ports/calendar-auth.js";

export type GoogleCalendarConnectionStatus = {
  provider: "google";
  connected: boolean;
  reconnectRequired: boolean;
  requiredScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  bookable: boolean;
};

export type GoogleCalendarDiscoveryClient = {
  listCalendars(): Promise<GoogleCalendarSummary[]>;
};

export type GoogleCalendarOnboardingServiceOptions = {
  credentials: CalendarCredentialRepository;
  requiredScopes: string[];
  oauthService?: {
    createAuthorizationUrl(clinicId: string, options?: { returnPath?: string }): string;
  };
  calendarClientFactory: (clinicId: string) => GoogleCalendarDiscoveryClient;
};

export class GoogleCalendarOnboardingService {
  constructor(private readonly options: GoogleCalendarOnboardingServiceOptions) {}

  async status(clinicId: string): Promise<GoogleCalendarConnectionStatus> {
    const credentials = await this.options.credentials.get({ clinicId, provider: "google" });
    return googleCalendarConnectionStatus({
      credentials,
      requiredScopes: this.options.requiredScopes
    });
  }

  createAuthorizationUrl(clinicId: string, returnPath: string): string {
    if (!this.options.oauthService) {
      throw new GoogleCalendarOnboardingError("google_calendar_oauth_not_configured");
    }
    return this.options.oauthService.createAuthorizationUrl(clinicId, { returnPath });
  }

  async listCalendars(clinicId: string): Promise<GoogleCalendarSummary[]> {
    const status = await this.status(clinicId);
    if (!status.connected) {
      throw new GoogleCalendarOnboardingError("google_calendar_not_connected");
    }
    if (status.reconnectRequired) {
      throw new GoogleCalendarOnboardingError("google_calendar_reconnect_required");
    }

    return this.options.calendarClientFactory(clinicId).listCalendars();
  }
}

export class GoogleCalendarOnboardingError extends Error {
  constructor(
    readonly code:
      | "google_calendar_not_connected"
      | "google_calendar_reconnect_required"
      | "google_calendar_calendar_not_bookable"
      | "google_calendar_oauth_not_configured"
  ) {
    super(code);
  }
}

export function googleCalendarConnectionStatus(input: {
  credentials: CalendarCredentials | undefined;
  requiredScopes: string[];
}): GoogleCalendarConnectionStatus {
  const grantedScopes = input.credentials?.scopes ?? [];
  const grantedScopeSet = new Set(grantedScopes);
  const missingScopes = input.requiredScopes.filter((scope) => !grantedScopeSet.has(scope));
  return {
    provider: "google",
    connected: Boolean(input.credentials),
    reconnectRequired: !input.credentials || missingScopes.length > 0,
    requiredScopes: [...input.requiredScopes],
    grantedScopes: [...grantedScopes],
    missingScopes
  };
}
