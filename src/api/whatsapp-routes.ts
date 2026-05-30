import type { FastifyInstance } from "fastify";
import { KapsoWebhookPayloadError, normalizeKapsoInboundMessage } from "../adapters/whatsapp/kapso/types.js";
import type { WhatsAppInboundService } from "../application/messaging/whatsapp-inbound-service.js";
import type { ClinicActivationGuard } from "../ports/activation.js";
import { CalendarInfrastructureError } from "../ports/calendar.js";
import { WhatsAppProviderError } from "../ports/messaging.js";
import { verifyKapsoWebhookSignature } from "../adapters/whatsapp/kapso/signature.js";

export type WhatsAppKapsoWebhookRoutesOptions = {
  secret: string;
  phoneNumberClinicMap: Record<string, string>;
  inboundService: WhatsAppInboundService;
  activation?: ClinicActivationGuard;
};

export function registerWhatsAppRoutes(app: FastifyInstance, options: WhatsAppKapsoWebhookRoutesOptions) {
  app.register(async (plugin) => {
    plugin.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });

    plugin.post("/webhooks/whatsapp/kapso", async (request, reply) => {
      const rawBody = typeof request.body === "string" ? request.body : "";
      const signature = getHeader(request.headers["x-webhook-signature"]);

      if (
        !verifyKapsoWebhookSignature({
          rawBody,
          signature,
          secret: options.secret
        })
      ) {
        return reply.status(401).send({ error: "invalid_webhook_signature" });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        return reply.status(400).send({ error: "invalid_webhook_payload" });
      }

      const providerPhoneNumberId = extractProviderPhoneNumberId(payload);
      if (!providerPhoneNumberId) {
        return reply.status(400).send({ error: "invalid_webhook_payload" });
      }

      const clinicId = options.phoneNumberClinicMap[providerPhoneNumberId];
      if (!clinicId) {
        return reply.status(400).send({ error: "unknown_provider_phone_number_id" });
      }

      if (options.activation && !(await options.activation.isClinicActive(clinicId))) {
        return reply.send({ status: "ignored", reason: "clinic_inactive" });
      }

      try {
        const normalizedMessage = normalizeKapsoInboundMessage({
          clinicId,
          payload,
          idempotencyKey: getHeader(request.headers["x-idempotency-key"])
        });
        const result = await options.inboundService.handleInboundMessage(normalizedMessage);
        return reply.send(result);
      } catch (error) {
        if (error instanceof KapsoWebhookPayloadError) {
          return reply.status(400).send({ error: "invalid_webhook_payload" });
        }
        if (error instanceof CalendarInfrastructureError) {
          return reply.status(503).send({
            error: "calendar_provider_not_configured",
            message: error.message
          });
        }
        if (error instanceof WhatsAppProviderError) {
          return reply.status(502).send({ error: "whatsapp_provider_send_failed" });
        }
        throw error;
      }
    });
  });
}

function getHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function extractProviderPhoneNumberId(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const record = payload as {
    phone_number_id?: unknown;
    conversation?: { phone_number_id?: unknown };
  };
  if (typeof record.phone_number_id === "string" && record.phone_number_id) {
    return record.phone_number_id;
  }
  if (
    typeof record.conversation?.phone_number_id === "string" &&
    record.conversation.phone_number_id
  ) {
    return record.conversation.phone_number_id;
  }
  return undefined;
}
