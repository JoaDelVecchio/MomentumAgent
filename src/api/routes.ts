import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildDevContainer } from "../dev/seed.js";

const inboundMessageSchema = z.object({
  clinicId: z.string(),
  conversationId: z.string(),
  patientId: z.string(),
  whatsappNumber: z.string(),
  text: z.string()
});

type SimulationRoutesOptions = {
  now?: Date;
};

export function registerRoutes(app: FastifyInstance, options: SimulationRoutesOptions = {}) {
  const container = buildDevContainer({ now: options.now });

  app.post("/simulate/inbound-message", async (request, reply) => {
    const parsed = inboundMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_inbound_message" });
    }

    const input = parsed.data;
    const result = await container.workflow.handleInboundMessage(input);
    return reply.send(result);
  });

  app.get("/simulate/audit-log", async () => {
    return container.audit.list();
  });
}
