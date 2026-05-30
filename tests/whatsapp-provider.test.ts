import { describe, expect, it } from "vitest";
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
