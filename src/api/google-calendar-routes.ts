import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  GoogleOAuthInsufficientScopesError,
  GoogleOAuthInvalidStateError,
  GoogleOAuthMissingRefreshTokenError,
  type GoogleOAuthService
} from "../adapters/google/google-oauth.js";

const startQuerySchema = z.object({
  clinicId: z.string().min(1),
  setupToken: z.string().optional()
});

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export type GoogleCalendarRoutesOptions = {
  oauthService: GoogleOAuthService;
  setupToken: string;
};

export function registerGoogleCalendarRoutes(
  app: FastifyInstance,
  options: GoogleCalendarRoutesOptions
) {
  app.get("/integrations/google-calendar/start", async (request, reply) => {
    const parsed = startQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_google_calendar_oauth_start" });
    }
    if (
      !matchesToken(
        readSetupToken(request.headers["x-momentum-setup-token"], parsed.data.setupToken),
        options.setupToken
      )
    ) {
      return reply.status(401).send({ error: "unauthorized_google_calendar_oauth_start" });
    }

    return reply.redirect(options.oauthService.createAuthorizationUrl(parsed.data.clinicId));
  });

  app.get("/integrations/google-calendar/callback", async (request, reply) => {
    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_google_calendar_oauth_callback" });
    }

    try {
      const result = await options.oauthService.handleCallback(
        parsed.data.code,
        parsed.data.state
      );
      if (result.returnPath) {
        return reply.redirect(result.returnPath);
      }
      return reply.send({ status: "connected", clinicId: result.clinicId });
    } catch (error) {
      if (
        error instanceof GoogleOAuthInvalidStateError ||
        error instanceof GoogleOAuthMissingRefreshTokenError ||
        error instanceof GoogleOAuthInsufficientScopesError
      ) {
        return reply.status(400).send({ error: "invalid_google_calendar_oauth_callback" });
      }
      throw error;
    }
  });
}

function readSetupToken(
  headerToken: string | string[] | undefined,
  queryToken: string | undefined
) {
  const rawHeaderToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return queryToken ?? rawHeaderToken?.replace(/^Bearer\s+/iu, "");
}

function matchesToken(actual: string | undefined, expected: string) {
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
