import type {
  CalendarCredentialRepository,
  CalendarCredentials
} from "../../ports/calendar-auth.js";
import type { ClinicProfile } from "../../domain/types.js";

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

export function hasUsableProfessionalCalendarMappings(
  profile: ClinicProfile | undefined,
  calendars?: GoogleCalendarSummary[]
): boolean {
  if (!profile) {
    return false;
  }
  if (profile.services.length === 0) {
    return false;
  }
  const bookableCalendarIds = calendars
    ? new Set(calendars.filter((calendar) => calendar.bookable).map((calendar) => calendar.id))
    : undefined;
  const calendarIds = profile.professionals
    .map((professional) => professional.calendarId.trim())
    .filter((calendarId) => calendarId.length > 0);
  if (calendarIds.length === 0 || new Set(calendarIds).size !== calendarIds.length) {
    return false;
  }
  if (bookableCalendarIds && !calendarIds.every((calendarId) => bookableCalendarIds.has(calendarId))) {
    return false;
  }
  const mappedProfessionalIds = new Set(
    profile.professionals
      .filter((professional) => {
        const calendarId = professional.calendarId.trim();
        return calendarId.length > 0 && (!bookableCalendarIds || bookableCalendarIds.has(calendarId));
      })
      .map((professional) => professional.id)
  );
  return profile.services.every((service) =>
    service.professionalIds.some((professionalId) => mappedProfessionalIds.has(professionalId))
  );
}
