import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  OutboundAutomationService,
  OutboundAutomationSummary
} from "../application/outbound/outbound-automation-service.js";

const runOutboundSchema = z.object({
  clinicId: z.string().min(1),
  now: z.coerce.date().optional(),
  reminders: z.boolean().optional(),
  reactivations: z.boolean().optional()
});

const zeroSummary: OutboundAutomationSummary = { sent: 0, blocked: 0, failed: 0, skipped: 0 };

export type OutboundAutomationRoutesOptions = {
  token: string;
  service: Pick<OutboundAutomationService, "runDueReminders" | "runDueReactivations">;
};

export function registerOutboundAutomationRoutes(
  app: FastifyInstance,
  options: OutboundAutomationRoutesOptions
) {
  app.post("/internal/outbound/run", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const parsed = runOutboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_outbound_run_request" });
    }

    const now = parsed.data.now ?? new Date();
    const input = { clinicId: parsed.data.clinicId, now };
    const reminders =
      parsed.data.reminders === false
        ? zeroSummary
        : await options.service.runDueReminders(input);
    const reactivations =
      parsed.data.reactivations === false
        ? zeroSummary
        : await options.service.runDueReactivations(input);

    return reply.send({ reminders, reactivations });
  });
}
