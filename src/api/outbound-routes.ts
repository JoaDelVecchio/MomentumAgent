import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  OutboundAutomationService,
  OutboundAutomationSummary
} from "../application/outbound/outbound-automation-service.js";

const runOutboundSchema = z.object({
  clinicId: z.string().min(1),
  now: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
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
    if (!matchesBearerToken(request.headers.authorization, options.token)) {
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

function readBearerToken(authorization: string | string[] | undefined) {
  if (!authorization || Array.isArray(authorization)) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  return match?.[1];
}

function matchesBearerToken(authorization: string | string[] | undefined, expected: string) {
  const actual = readBearerToken(authorization);
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
