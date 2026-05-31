import Fastify from "fastify";
import type { GoogleOAuthService } from "../adapters/google/google-oauth.js";
import type { CalendarProvider } from "../dev/seed.js";
import type { ClinicActivationGuard } from "../ports/activation.js";
import type { CalendarPort } from "../ports/calendar.js";
import type { LoggerPort } from "../ports/logger.js";
import {
  registerConversationControlRoutes,
  type ConversationControlRoutesOptions
} from "./conversation-control-routes.js";
import {
  registerGoogleCalendarOnboardingRoutes,
  type GoogleCalendarOnboardingRoutesOptions
} from "./google-calendar-onboarding-routes.js";
import { registerGoogleCalendarRoutes } from "./google-calendar-routes.js";
import {
  registerOutboundAutomationRoutes,
  type OutboundAutomationRoutesOptions
} from "./outbound-routes.js";
import {
  registerOnboardingRoutes,
  type OnboardingRoutesOptions
} from "./onboarding-routes.js";
import { registerRoutes } from "./routes.js";
import { registerWhatsAppRoutes, type WhatsAppKapsoWebhookRoutesOptions } from "./whatsapp-routes.js";

type BuildAppOptions = {
  enableSimulationRoutes?: boolean;
  simulationNow?: Date;
  calendarProvider?: CalendarProvider;
  simulationCalendar?: CalendarPort;
  googleCalendarOAuthService?: GoogleOAuthService;
  googleCalendarSetupToken?: string;
  whatsappKapsoWebhook?: WhatsAppKapsoWebhookRoutesOptions;
  outboundAutomation?: OutboundAutomationRoutesOptions;
  onboarding?: OnboardingRoutesOptions;
  googleCalendarOnboarding?: GoogleCalendarOnboardingRoutesOptions;
  conversationControl?: ConversationControlRoutesOptions;
  clinicActivation?: ClinicActivationGuard;
  logger?: LoggerPort;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (options.enableSimulationRoutes) {
    registerRoutes(app, {
      now: options.simulationNow,
      calendarProvider: options.calendarProvider,
      calendar: options.simulationCalendar
    });
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

  if (options.whatsappKapsoWebhook) {
    registerWhatsAppRoutes(app, {
      ...options.whatsappKapsoWebhook,
      activation: options.whatsappKapsoWebhook.activation ?? options.clinicActivation,
      logger: options.whatsappKapsoWebhook.logger ?? options.logger
    });
  }

  if (options.outboundAutomation) {
    registerOutboundAutomationRoutes(app, {
      ...options.outboundAutomation,
      activation: options.outboundAutomation.activation ?? options.clinicActivation,
      logger: options.outboundAutomation.logger ?? options.logger
    });
  }

  if (options.onboarding) {
    registerOnboardingRoutes(app, options.onboarding);
  }

  if (options.googleCalendarOnboarding) {
    registerGoogleCalendarOnboardingRoutes(app, options.googleCalendarOnboarding);
  }

  if (options.conversationControl) {
    registerConversationControlRoutes(app, options.conversationControl);
  }

  return app;
}
