import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { CalendarCredentialRepository } from "../../ports/calendar-auth.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  type GoogleCalendarConfig
} from "../../config/google-calendar.js";

export { GOOGLE_CALENDAR_SCOPES };

export type GoogleAuthorizationUrlInput = {
  access_type: "offline";
  prompt: "consent";
  scope: string[];
  state: string;
  include_granted_scopes: boolean;
};

export type GoogleOAuthTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
};

export type GoogleOAuthClient = {
  generateAuthUrl(input: GoogleAuthorizationUrlInput): string;
  getToken(input: { code: string }): Promise<{ tokens: GoogleOAuthTokens }>;
};

type GoogleOAuthClientFactory = (config: GoogleCalendarConfig) => GoogleOAuthClient;

export class GoogleOAuthInvalidStateError extends Error {
  constructor() {
    super("Invalid Google OAuth state");
  }
}

export class GoogleOAuthMissingRefreshTokenError extends Error {
  constructor() {
    super("Google OAuth callback did not include a refresh token");
  }
}

export class GoogleOAuthInsufficientScopesError extends Error {
  constructor() {
    super("Google OAuth callback did not include all required scopes");
  }
}

export class GoogleOAuthService {
  private readonly client: GoogleOAuthClient;

  constructor(
    private readonly config: GoogleCalendarConfig,
    private readonly credentialRepository: CalendarCredentialRepository,
    clientFactory: GoogleOAuthClientFactory = createGoogleOAuthClient
  ) {
    this.client = clientFactory(config);
  }

  createAuthorizationUrl(clinicId: string) {
    return this.client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: this.config.scopes,
      state: encodeGoogleOAuthState(clinicId, this.config.stateSecret),
      include_granted_scopes: true
    });
  }

  async handleCallback(code: string, state: string) {
    const clinicId = decodeGoogleOAuthState(state, this.config.stateSecret);
    const { tokens } = await this.client.getToken({ code });
    const refreshToken = tokens.refresh_token ?? undefined;
    const existingCredentials = refreshToken
      ? undefined
      : await this.credentialRepository.get({ clinicId, provider: "google" });
    if (!refreshToken && !existingCredentials) {
      throw new GoogleOAuthMissingRefreshTokenError();
    }

    const grantedScopes = parseGrantedScopes(tokens.scope);
    assertRequiredScopesGranted(grantedScopes, this.config.scopes);

    await this.credentialRepository.save({
      clinicId,
      provider: "google",
      scopes: grantedScopes,
      accessToken: tokens.access_token ?? undefined,
      refreshToken,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
    });

    return { clinicId };
  }
}

function createGoogleOAuthClient(config: GoogleCalendarConfig): GoogleOAuthClient {
  const client = new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri
  });

  return {
    generateAuthUrl: (input) => client.generateAuthUrl(input),
    getToken: async (input) => {
      const { tokens } = await client.getToken(input);
      return { tokens };
    }
  };
}

function encodeGoogleOAuthState(clinicId: string, stateSecret: string) {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ clinicId, nonce }), "utf8").toString(
    "base64url"
  );
  const signature = signOAuthState(payload, stateSecret);
  return `${payload}.${signature}`;
}

function decodeGoogleOAuthState(state: string, stateSecret: string) {
  const parts = state.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new GoogleOAuthInvalidStateError();
  }

  const [payload, signature] = parts;
  const expectedSignature = signOAuthState(payload, stateSecret);
  if (!sameSignature(signature, expectedSignature)) {
    throw new GoogleOAuthInvalidStateError();
  }

  return parseStatePayload(payload).clinicId;
}

function signOAuthState(payload: string, stateSecret: string) {
  return createHmac("sha256", stateSecret).update(payload).digest("hex");
}

function sameSignature(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function parseGrantedScopes(scope: string | null | undefined) {
  return scope ? scope.split(/\s+/u).filter(Boolean) : [];
}

function assertRequiredScopesGranted(grantedScopes: string[], requiredScopes: string[]) {
  const grantedScopeSet = new Set(grantedScopes);
  if (!requiredScopes.every((scope) => grantedScopeSet.has(scope))) {
    throw new GoogleOAuthInsufficientScopesError();
  }
}

function parseStatePayload(payload: string) {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isStatePayload(parsed)) {
      throw new GoogleOAuthInvalidStateError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof GoogleOAuthInvalidStateError) {
      throw error;
    }
    throw new GoogleOAuthInvalidStateError();
  }
}

function isStatePayload(value: unknown): value is { clinicId: string; nonce: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "clinicId" in value &&
    "nonce" in value &&
    typeof value.clinicId === "string" &&
    value.clinicId.length > 0 &&
    typeof value.nonce === "string" &&
    value.nonce.length > 0
  );
}
