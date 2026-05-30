import { describe, expect, it } from "vitest";
import {
  KapsoWebhookPayloadError,
  normalizeKapsoInboundMessage
} from "../src/adapters/whatsapp/kapso/types.js";
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
