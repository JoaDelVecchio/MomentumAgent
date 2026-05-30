import Fastify from "fastify";
import type { GoogleOAuthService } from "../adapters/google/google-oauth.js";
import { registerGoogleCalendarRoutes } from "./google-calendar-routes.js";
import { registerRoutes } from "./routes.js";

type BuildAppOptions = {
  enableSimulationRoutes?: boolean;
  simulationNow?: Date;
  googleCalendarOAuthService?: GoogleOAuthService;
  googleCalendarSetupToken?: string;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (options.enableSimulationRoutes) {
    registerRoutes(app, { now: options.simulationNow });
  }

  if (options.googleCalendarOAuthService) {
    if (!options.googleCalendarSetupToken) {
      throw new Error("googleCalendarSetupToken is required when Google OAuth routes are enabled");
    }
    registerGoogleCalendarRoutes(app, {
      oauthService: options.googleCalendarOAuthService,
      setupToken: options.googleCalendarSetupToken
    });
  }

  return app;
}
