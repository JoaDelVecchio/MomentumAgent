import { describe, expect, it, vi } from "vitest";
import { KapsoWhatsAppProvider } from "../src/adapters/whatsapp/kapso/kapso-whatsapp-provider.js";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { OutboundTemplateService } from "../src/application/messaging/outbound-template-service.js";
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

describe("OutboundTemplateService", () => {
  it("blocks approved template sends when the WhatsApp number opted out", async () => {
    const context = buildOutboundTemplateContext();
    context.repos.markOptOut("+5491111111111");

    const result = await context.service.sendApprovedTemplate(templateInput());

    expect(result).toEqual({ status: "blocked_opt_out" });
    expect(context.provider.sentTemplateMessages).toEqual([]);
    expect(await context.audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        type: "whatsapp.template.blocked",
        metadata: {
          to: "+5491111111111",
          templateName: "appointment_reminder_24h",
          reason: "opt_out"
        }
      })
    );
  });

  it("sends allowed templates and records an audit event", async () => {
    const context = buildOutboundTemplateContext();

    const result = await context.service.sendApprovedTemplate(templateInput());

    expect(result).toEqual({ status: "sent", providerMessageId: "msg_1" });
    expect(context.provider.sentTemplateMessages).toEqual([
      {
        ...templateInput(),
        providerMessageId: "msg_1"
      }
    ]);
    expect(await context.audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        type: "whatsapp.template.sent",
        metadata: {
          to: "+5491111111111",
          templateName: "appointment_reminder_24h",
          providerMessageId: "msg_1"
        }
      })
    );
  });

  it("records an audit event and rethrows provider failures", async () => {
    const context = buildOutboundTemplateContext();
    context.provider.failNextSend("kapso unavailable");

    await expect(context.service.sendApprovedTemplate(templateInput())).rejects.toBeInstanceOf(
      WhatsAppProviderError
    );

    expect(await context.audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        type: "whatsapp.template.failed",
        metadata: {
          to: "+5491111111111",
          templateName: "appointment_reminder_24h"
        }
      })
    );
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

function buildOutboundTemplateContext() {
  const repos = new InMemoryRepositories();
  const provider = new FakeWhatsAppProvider();
  const audit = new InMemoryAuditLog();
  const service = new OutboundTemplateService({ repos, provider, audit });

  return { repos, provider, audit, service };
}

function templateInput() {
  return {
    clinicId: "clinic_1",
    to: "+5491111111111",
    templateName: "appointment_reminder_24h",
    languageCode: "es_AR",
    parameters: ["Ana", "2026-06-01 10:00"]
  };
}
