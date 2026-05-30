import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  GoogleCalendarOnboardingError,
  type GoogleCalendarOnboardingService
} from "../application/onboarding/google-calendar-onboarding-service.js";
import { isAuthorized } from "./internal-auth.js";

const clinicParamsSchema = z.object({ clinicId: z.string().min(1) });

export type GoogleCalendarOnboardingRoutesOptions = {
  adminToken: string;
  service: Pick<GoogleCalendarOnboardingService, "status" | "createAuthorizationUrl" | "listCalendars">;
};

export function registerGoogleCalendarOnboardingRoutes(
  app: FastifyInstance,
  options: GoogleCalendarOnboardingRoutesOptions
) {
  app.get("/internal/onboarding/clinics/:clinicId/google-calendar/status", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    return reply.send({ status: await options.service.status(params.data.clinicId) });
  });

  app.post("/internal/onboarding/clinics/:clinicId/google-calendar/start", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    const returnPath = `/internal/onboarding/clinics/${encodeURIComponent(
      params.data.clinicId
    )}?googleCalendar=connected`;
    try {
      return reply.send({
        authorizationUrl: options.service.createAuthorizationUrl(params.data.clinicId, returnPath)
      });
    } catch (error) {
      if (error instanceof GoogleCalendarOnboardingError) {
        return reply.status(409).send({ error: error.code });
      }
      throw error;
    }
  });

  app.get("/internal/onboarding/clinics/:clinicId/google-calendar/calendars", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    try {
      return reply.send({ calendars: await options.service.listCalendars(params.data.clinicId) });
    } catch (error) {
      if (error instanceof GoogleCalendarOnboardingError) {
        return reply.status(409).send({ error: error.code });
      }
      throw error;
    }
  });
}
