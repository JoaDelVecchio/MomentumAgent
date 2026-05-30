import { describe, expect, it, vi } from "vitest";
import { KapsoWhatsAppProvider } from "../src/adapters/whatsapp/kapso/kapso-whatsapp-provider.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { WhatsAppProviderError } from "../src/ports/messaging.js";

describe("FakeWhatsAppProvider", () => {
  it("records text messages with deterministic provider ids", async () => {
    const provider = new FakeWhatsAppProvider();

    const result = await provider.sendText({
      clinicId: "clinic_1",
      to: "+5491111111111",
      text: "Tengo un turno disponible mañana."
    });

    expect(result).toEqual({ providerMessageId: "msg_1" });
    expect(provider.sentTextMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "+5491111111111",
        text: "Tengo un turno disponible mañana.",
        providerMessageId: "msg_1"
      }
    ]);
  });

  it("records template messages with deterministic provider ids", async () => {
    const provider = new FakeWhatsAppProvider();

    const result = await provider.sendTemplate({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "appointment_reminder_24h",
      languageCode: "es_AR",
      parameters: ["Ana", "Botox", "2026-06-01 10:00"]
    });

    expect(result).toEqual({ providerMessageId: "msg_1" });
    expect(provider.sentTemplateMessages).toEqual([
      {
        clinicId: "clinic_1",
        to: "+5491111111111",
        templateName: "appointment_reminder_24h",
        languageCode: "es_AR",
        parameters: ["Ana", "Botox", "2026-06-01 10:00"],
        providerMessageId: "msg_1"
      }
    ]);
  });

  it("can fail the next send with a provider error", async () => {
    const provider = new FakeWhatsAppProvider();
    provider.failNextSend("kapso unavailable");

    await expect(
      provider.sendText({
        clinicId: "clinic_1",
        to: "+5491111111111",
        text: "Hola"
      })
    ).rejects.toBeInstanceOf(WhatsAppProviderError);

    await expect(
      provider.sendTemplate({
        clinicId: "clinic_1",
        to: "+5491111111111",
        templateName: "appointment_reminder_24h",
        languageCode: "es_AR",
        parameters: []
      })
    ).resolves.toEqual({ providerMessageId: "msg_1" });
  });
});

describe("KapsoWhatsAppProvider", () => {
  it("sends text messages to Kapso's WhatsApp message endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid_text_1" }] }));
    const provider = new KapsoWhatsAppProvider({
      apiKey: "kapso_api_key",
      phoneNumberId: "phone_number_123",
      fetch
    });

    const result = await provider.sendText({
      clinicId: "clinic_1",
      to: "+5491111111111",
      text: "Tengo un turno disponible mañana."
    });

    expect(result).toEqual({ providerMessageId: "wamid_text_1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.kapso.ai/meta/whatsapp/v24.0/phone_number_123/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "kapso_api_key"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "+5491111111111",
          type: "text",
          text: { body: "Tengo un turno disponible mañana." }
        })
      }
    );
  });

  it("sends approved template messages through Kapso", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid_template_1" }] }));
    const provider = new KapsoWhatsAppProvider({
      apiKey: "kapso_api_key",
      phoneNumberId: "phone_number_123",
      fetch
    });

    const result = await provider.sendTemplate({
      clinicId: "clinic_1",
      to: "+5491111111111",
      templateName: "appointment_reminder_24h",
      languageCode: "es_AR",
      parameters: ["Ana", "2026-06-01 10:00"]
    });

    expect(result).toEqual({ providerMessageId: "wamid_template_1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.kapso.ai/meta/whatsapp/v24.0/phone_number_123/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "+5491111111111",
          type: "template",
          template: {
            name: "appointment_reminder_24h",
            language: { code: "es_AR" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: "Ana" },
                  { type: "text", text: "2026-06-01 10:00" }
                ]
              }
            ]
          }
        })
      })
    );
  });

  it("throws provider errors for non-2xx Kapso responses", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid recipient" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );
    const provider = new KapsoWhatsAppProvider({
      apiKey: "kapso_api_key",
      phoneNumberId: "phone_number_123",
      fetch
    });

    await expect(
      provider.sendText({
        clinicId: "clinic_1",
        to: "+5491111111111",
        text: "Hola"
      })
    ).rejects.toMatchObject({
      name: "WhatsAppProviderError",
      statusCode: 400,
      message: "Kapso send failed: Invalid recipient"
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
