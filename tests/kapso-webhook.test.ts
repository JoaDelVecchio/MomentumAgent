import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import {
  KapsoWebhookPayloadError,
  normalizeKapsoInboundMessage
} from "../src/adapters/whatsapp/kapso/types.js";
import { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import type { WorkflowResult } from "../src/application/conversations/conversation-workflow.js";
import { buildApp } from "../src/api/app.js";
import {
  createKapsoWebhookSignature,
  verifyKapsoWebhookSignature
} from "../src/adapters/whatsapp/kapso/signature.js";

describe("Kapso webhook parsing", () => {
  it("normalizes received text messages into Momentum inbound messages", () => {
    const receivedAt = new Date("2026-05-29T12:00:00.000Z");

    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      idempotencyKey: "delivery_1",
      payload: kapsoReceivedMessagePayload(),
      receivedAt
    });

    expect(message).toEqual({
      clinicId: "clinic_1",
      providerPhoneNumberId: "123456789012345",
      providerMessageId: "wamid.123",
      conversationId: "conv_123",
      patientId: "whatsapp:16315551181",
      whatsappNumber: "16315551181",
      text: "Quiero reservar botox",
      idempotencyKey: "delivery_1",
      receivedAt
    });
  });

  it("falls back to provider message id when no idempotency key is present", () => {
    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      payload: kapsoReceivedMessagePayload()
    });

    expect(message.idempotencyKey).toBe("wamid.123");
  });

  it("uses business-scoped identity fields when phone fields are absent", () => {
    const payload = kapsoReceivedMessagePayloadWithOptionalPhoneFields();
    delete payload.message.from;
    delete payload.conversation.phone_number;

    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      idempotencyKey: "delivery_1",
      payload
    });

    expect(message.patientId).toBe("bsuid:US.13491208655302741918");
    expect(message.whatsappNumber).toBe("US.13491208655302741918");
  });

  it("normalizes booking reply button taps into deterministic commands", () => {
    const payload = kapsoReceivedMessagePayload() as any;
    payload.message.type = "interactive";
    payload.message.interactive = {
      type: "button_reply",
      button_reply: {
        id: "booking_confirm",
        title: "Confirmar"
      }
    };
    delete payload.message.text;
    delete payload.message.kapso.content;

    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      idempotencyKey: "delivery_button",
      payload
    });

    expect(message.text).toBe("confirmo");
  });

  it("normalizes interactive list selections using the selected row title", () => {
    const payload = kapsoReceivedMessagePayload() as any;
    payload.message.type = "interactive";
    payload.message.interactive = {
      type: "list_reply",
      list_reply: {
        id: "slot_1",
        title: "Jue 4 09:00",
        description: "Botox con Dra. Perez"
      }
    };
    delete payload.message.text;
    delete payload.message.kapso.content;

    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      idempotencyKey: "delivery_list",
      payload
    });

    expect(message.text).toBe("Jue 4 09:00");
  });

  it("normalizes completed Flow responses into deterministic commands", () => {
    const payload = kapsoReceivedMessagePayload() as any;
    payload.message.type = "interactive";
    payload.message.interactive = {
      type: "nfm_reply",
      nfm_reply: {
        name: "flow",
        body: "Sent",
        response_json: JSON.stringify({
          flow_token: "clinic_1:conv_123:wamid_123",
          action: "confirm_booking"
        })
      }
    };
    payload.message.kapso = {
      direction: "inbound",
      status: "received",
      processing_status: "pending",
      origin: "cloud_api",
      has_media: false,
      flow_response: {
        flow_token: "clinic_1:conv_123:wamid_123",
        action: "confirm_booking"
      },
      flow_token: "clinic_1:conv_123:wamid_123",
      flow_name: "flow"
    };
    delete payload.message.text;

    const message = normalizeKapsoInboundMessage({
      clinicId: "clinic_1",
      idempotencyKey: "delivery_flow",
      payload
    });

    expect(message.text).toBe("confirmo");
  });

  it("rejects malformed webhook payloads", () => {
    expect(() =>
      normalizeKapsoInboundMessage({
        clinicId: "clinic_1",
        payload: {
          message: { id: "wamid.123", type: "text", kapso: {} },
          conversation: { id: "conv_123" }
        }
      })
    ).toThrow(KapsoWebhookPayloadError);
  });

  it("rejects payloads without a provider phone number id", () => {
    const payload = kapsoReceivedMessagePayload() as Omit<
      ReturnType<typeof kapsoReceivedMessagePayload>,
      "phone_number_id" | "conversation"
    > & {
      phone_number_id?: string;
      conversation: Omit<
        ReturnType<typeof kapsoReceivedMessagePayload>["conversation"],
        "phone_number_id"
      > & {
        phone_number_id?: string;
      };
    };
    delete payload.phone_number_id;
    delete payload.conversation.phone_number_id;

    expect(() =>
      normalizeKapsoInboundMessage({
        clinicId: "clinic_1",
        payload
      })
    ).toThrow(KapsoWebhookPayloadError);
  });
});

describe("Kapso webhook signatures", () => {
  it("verifies HMAC SHA-256 webhook signatures with timing-safe comparison", () => {
    const rawBody = JSON.stringify(kapsoReceivedMessagePayload());
    const signature = createKapsoWebhookSignature(rawBody, "webhook_secret");

    expect(
      verifyKapsoWebhookSignature({
        rawBody,
        signature,
        secret: "webhook_secret"
      })
    ).toBe(true);
    expect(
      verifyKapsoWebhookSignature({
        rawBody,
        signature: "invalid_signature",
        secret: "webhook_secret"
      })
    ).toBe(false);
  });
});

describe("WhatsAppInboundService", () => {
  it("calls the conversation workflow and sends reply text through the provider", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(context.workflow.calls).toEqual([
      {
        clinicId: "clinic_1",
        conversationId: "conv_123",
        patientId: "whatsapp:16315551181",
        whatsappNumber: "16315551181",
        text: "Quiero reservar botox"
      }
    ]);
    expect(context.provider.sentTextMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "16315551181",
        text: "Tengo un turno disponible.",
        providerMessageId: "msg_1"
      }
    ]);
    expect(context.repos.hasProcessedWebhookDelivery("delivery_1")).toBe(true);
  });

  it("sends the handoff text once when the workflow asks for handoff", async () => {
    const context = buildInboundServiceContext({
      kind: "handoff",
      text: "Te derivo con recepcion por este mismo chat."
    });

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({
      status: "sent",
      workflowResult: "handoff",
      providerMessageId: "msg_1"
    });
    expect(context.provider.sentTextMessages).toHaveLength(1);
    expect(context.provider.sentTextMessages[0].text).toBe(
      "Te derivo con recepcion por este mismo chat."
    );
  });

  it("sends booking reply buttons when a reply leaves a pending booking", async () => {
    const context = buildInboundServiceContext({
      kind: "reply",
      text: "Tengo este horario: jueves 4 de junio a las 09:00 para Botox. Si te sirve, lo confirmamos."
    });
    context.repos.saveConversation(conversationWithPendingBooking());

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(context.provider.sentTextMessages).toEqual([]);
    expect(context.provider.sentInteractiveMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "16315551181",
        kind: "button",
        bodyText: "Tengo este horario: jueves 4 de junio a las 09:00 para Botox. Si te sirve, lo confirmamos.",
        buttons: [
          { id: "booking_confirm", title: "Confirmar" },
          { id: "booking_change", title: "Otro horario" },
          { id: "booking_handoff", title: "Recepcion" }
        ],
        providerMessageId: "msg_1"
      }
    ]);
  });

  it("sends a booking Flow CTA when a published Flow is configured", async () => {
    const context = buildInboundServiceContext(
      {
        kind: "reply",
        text: "Tengo este horario: jueves 4 de junio a las 09:00 para Botox. Si te sirve, lo confirmamos."
      },
      { bookingFlowId: "flow_booking_123", bookingFlowCta: "Ver turnos" }
    );
    context.repos.saveConversation(conversationWithPendingBooking());

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(context.provider.sentTextMessages).toEqual([]);
    expect(context.provider.sentInteractiveMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "16315551181",
        kind: "flow",
        bodyText: "Tengo este horario: jueves 4 de junio a las 09:00 para Botox. Si te sirve, lo confirmamos.",
        flowId: "flow_booking_123",
        flowCta: "Ver turnos",
        flowAction: "navigate",
        flowToken: "clinic_1:conv_123:wamid_123",
        flowActionPayload: {
          screen: "BOOKING",
          data: {
            appointmentId: "",
            conversationId: "conv_123",
            serviceId: "svc_botox",
            professionalId: "pro_perez",
            startsAt: "2026-06-04T12:00:00.000Z",
            endsAt: "2026-06-04T12:30:00.000Z",
            slotLockId: "lock_1"
          }
        },
        providerMessageId: "msg_1"
      }
    ]);
  });

  it("keeps patient-data collection replies as plain text", async () => {
    const context = buildInboundServiceContext({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });
    context.repos.saveConversation(conversationWithPendingBooking());

    await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(context.provider.sentTextMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "16315551181",
        text: "Perfecto. Para confirmar el turno, pasame nombre y apellido.",
        providerMessageId: "msg_1"
      }
    ]);
    expect(context.provider.sentInteractiveMessages).toEqual([]);
  });

  it("does not send automated replies when the conversation is already bot-paused", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "No deberia enviarse." });
    context.repos.saveConversation({
      id: "conv_123",
      clinicId: "clinic_1",
      patientId: "whatsapp:16315551181",
      botPaused: true,
      createdAt: new Date("2026-05-29T11:00:00.000Z"),
      updatedAt: new Date("2026-05-29T11:00:00.000Z")
    });

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({ status: "bot_paused" });
    expect(context.workflow.calls).toEqual([]);
    expect(context.provider.sentTextMessages).toEqual([]);
    expect(context.repos.hasProcessedWebhookDelivery("delivery_1")).toBe(true);
  });

  it("ignores duplicate idempotency keys without sending a second reply", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    context.repos.markProcessedWebhookDelivery("delivery_1");

    const result = await context.service.handleInboundMessage(normalizedInboundMessage());

    expect(result).toEqual({ status: "ignored_duplicate" });
    expect(context.workflow.calls).toEqual([]);
    expect(context.provider.sentTextMessages).toEqual([]);
  });

  it("serializes concurrent duplicate deliveries before sending replies", async () => {
    const context = buildInboundServiceContext({
      kind: "reply",
      text: "Tengo un turno disponible.",
      delayMs: 20
    });

    const results = await Promise.all([
      context.service.handleInboundMessage(normalizedInboundMessage()),
      context.service.handleInboundMessage(normalizedInboundMessage())
    ]);

    expect(results).toEqual([
      {
        status: "sent",
        workflowResult: "reply",
        providerMessageId: "msg_1"
      },
      { status: "ignored_duplicate" }
    ]);
    expect(context.workflow.calls).toHaveLength(1);
    expect(context.provider.sentTextMessages).toHaveLength(1);
  });

  it("audits send failures and leaves the delivery retryable", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    context.provider.failNextSend("kapso unavailable");

    await expect(context.service.handleInboundMessage(normalizedInboundMessage())).rejects.toMatchObject({
      name: "WhatsAppProviderError"
    });

    expect(context.repos.hasProcessedWebhookDelivery("delivery_1")).toBe(false);
    expect(await context.audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_123",
        type: "whatsapp.outbound.failed",
        metadata: {
          providerMessageId: "wamid.123",
          providerPhoneNumberId: "123456789012345"
        }
      })
    );
  });
});

describe("Kapso webhook route", () => {
  it("returns 401 on invalid webhook signatures", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    const app = buildWhatsAppWebhookApp(context);
    const rawBody = JSON.stringify(kapsoReceivedMessagePayload());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "invalid_signature",
        "X-Idempotency-Key": "delivery_1"
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_webhook_signature" });
    expect(context.provider.sentTextMessages).toEqual([]);
  });

  it("returns 400 on invalid webhook payloads", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    const app = buildWhatsAppWebhookApp(context);
    const rawBody = JSON.stringify({ invalid: true });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_webhook_payload" });
    expect(context.provider.sentTextMessages).toEqual([]);
  });

  it("logs inbound failures when Kapso payload normalization fails", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    const logger = new FakeLogger();
    const app = buildWhatsAppWebhookApp(context, logger);
    const rawBody = JSON.stringify({
      phone_number_id: "123456789012345",
      message: { id: "wamid.123", type: "unsupported" },
      conversation: { id: "conv_123", phone_number_id: "123456789012345" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_webhook_payload" });
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "error",
        event: "whatsapp.inbound.failed",
        clinicId: "clinic_1",
        error: expect.any(String)
      })
    ]);
  });

  it("returns 200 on valid messages and sends exactly one provider message", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    const app = buildWhatsAppWebhookApp(context);
    const rawBody = JSON.stringify(kapsoReceivedMessagePayload());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "sent",
      workflowResult: "reply",
      providerMessageId: "msg_1"
    });
    expect(context.provider.sentTextMessages).toHaveLength(1);
  });

  it("returns 200 for duplicate deliveries without sending another provider message", async () => {
    const context = buildInboundServiceContext({ kind: "reply", text: "Tengo un turno disponible." });
    const app = buildWhatsAppWebhookApp(context);
    const rawBody = JSON.stringify(kapsoReceivedMessagePayload());

    await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });
    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/kapso",
      headers: signedWebhookHeaders(rawBody),
      payload: rawBody
    });

    expect(duplicateResponse.statusCode).toBe(200);
    expect(duplicateResponse.json()).toEqual({ status: "ignored_duplicate" });
    expect(context.provider.sentTextMessages).toHaveLength(1);
  });
});

function kapsoReceivedMessagePayload() {
  return {
    event: "whatsapp.message.received",
    message: {
      id: "wamid.123",
      timestamp: "1730092800",
      type: "text",
      from: "16315551181",
      from_user_id: "US.13491208655302741918",
      from_parent_user_id: "US.ENT.506847293015824",
      username: "@testusername",
      text: { body: "Quiero reservar botox" },
      kapso: {
        direction: "inbound",
        status: "received",
        processing_status: "pending",
        origin: "cloud_api",
        has_media: false,
        content: "Quiero reservar botox"
      }
    },
    conversation: {
      id: "conv_123",
      phone_number: "16315551181",
      business_scoped_user_id: "US.13491208655302741918",
      parent_business_scoped_user_id: "US.ENT.506847293015824",
      username: "@testusername",
      status: "active",
      phone_number_id: "123456789012345"
    },
    is_new_conversation: true,
    phone_number_id: "123456789012345"
  };
}

function kapsoReceivedMessagePayloadWithOptionalPhoneFields() {
  return kapsoReceivedMessagePayload() as Omit<
    ReturnType<typeof kapsoReceivedMessagePayload>,
    "message" | "conversation"
  > & {
    message: Omit<ReturnType<typeof kapsoReceivedMessagePayload>["message"], "from"> & {
      from?: string;
    };
    conversation: Omit<
      ReturnType<typeof kapsoReceivedMessagePayload>["conversation"],
      "phone_number"
    > & {
      phone_number?: string;
    };
  };
}

function normalizedInboundMessage() {
  return {
    clinicId: "clinic_1",
    providerPhoneNumberId: "123456789012345",
    providerMessageId: "wamid.123",
    conversationId: "conv_123",
    patientId: "whatsapp:16315551181",
    whatsappNumber: "16315551181",
    text: "Quiero reservar botox",
    idempotencyKey: "delivery_1",
    receivedAt: new Date("2026-05-29T12:00:00.000Z")
  };
}

function buildInboundServiceContext(
  result: WorkflowResult & { delayMs?: number },
  interactive?: { bookingFlowId?: string; bookingFlowCta?: string }
) {
  const repos = new InMemoryRepositories();
  const provider = new FakeWhatsAppProvider();
  const audit = new InMemoryAuditLog();
  const workflow = new FakeConversationWorkflow(result);
  const service = new WhatsAppInboundService({
    repos,
    provider,
    workflow,
    audit,
    interactive
  });

  return { repos, provider, audit, workflow, service };
}

function conversationWithPendingBooking() {
  return {
    id: "conv_123",
    clinicId: "clinic_1",
    patientId: "whatsapp:16315551181",
    botPaused: false,
    pendingBooking: {
      slotLockId: "lock_1",
      slotLockExpiresAt: new Date("2026-06-04T11:40:00.000Z"),
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      startsAt: new Date("2026-06-04T12:00:00.000Z"),
      endsAt: new Date("2026-06-04T12:30:00.000Z")
    },
    createdAt: new Date("2026-06-04T11:00:00.000Z"),
    updatedAt: new Date("2026-06-04T11:30:00.000Z")
  };
}

function buildWhatsAppWebhookApp(
  context: ReturnType<typeof buildInboundServiceContext>,
  logger?: FakeLogger
) {
  return buildApp({
    whatsappKapsoWebhook: {
      secret: "webhook_secret",
      phoneNumberClinicMap: { "123456789012345": "clinic_1" },
      inboundService: context.service,
      logger
    }
  });
}

function signedWebhookHeaders(rawBody: string) {
  return {
    "Content-Type": "application/json",
    "X-Webhook-Signature": createKapsoWebhookSignature(rawBody, "webhook_secret"),
    "X-Idempotency-Key": "delivery_1"
  };
}

class FakeConversationWorkflow {
  readonly calls: Array<{
    clinicId: string;
    conversationId: string;
    patientId: string;
    whatsappNumber: string;
    text: string;
  }> = [];

  constructor(private readonly result: WorkflowResult & { delayMs?: number }) {}

  async handleInboundMessage(input: {
    clinicId: string;
    conversationId: string;
    patientId: string;
    whatsappNumber: string;
    text: string;
  }) {
    if (this.result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.result.delayMs));
    }
    this.calls.push(input);
    const { delayMs: _delayMs, ...result } = this.result;
    return result;
  }
}

class FakeLogger {
  readonly entries: unknown[] = [];

  info(input: unknown) {
    this.entries.push({ level: "info", ...(input as object) });
  }

  warn(input: unknown) {
    this.entries.push({ level: "warn", ...(input as object) });
  }

  error(input: unknown) {
    this.entries.push({ level: "error", ...(input as object) });
  }
}
