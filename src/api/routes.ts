import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildDevContainer, type CalendarProvider } from "../dev/seed.js";
import type { CalendarPort } from "../ports/calendar.js";
import { CalendarInfrastructureError } from "../ports/calendar.js";

const inboundMessageSchema = z.object({
  clinicId: z.string(),
  conversationId: z.string(),
  patientId: z.string(),
  whatsappNumber: z.string(),
  text: z.string()
});

type SimulationRoutesOptions = {
  now?: Date;
  calendarProvider?: CalendarProvider;
  calendar?: CalendarPort;
};

export function registerRoutes(app: FastifyInstance, options: SimulationRoutesOptions = {}) {
  const container = buildDevContainer({
    now: options.now,
    calendarProvider: options.calendarProvider,
    calendar: options.calendar
  });

  app.post("/simulate/inbound-message", async (request, reply) => {
    const parsed = inboundMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_inbound_message" });
    }

    const input = parsed.data;
    try {
      const result = await container.workflow.handleInboundMessage(input);
      return reply.send(result);
    } catch (error) {
      if (error instanceof CalendarInfrastructureError) {
        return reply.status(503).send({
          error: "calendar_provider_not_configured",
          message: error.message
        });
      }
      throw error;
    }
  });

  app.get("/simulate/audit-log", async () => {
    return container.audit.list();
  });
}
