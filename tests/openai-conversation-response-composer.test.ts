import { describe, expect, it } from "vitest";
import { OpenAIConversationResponseComposer } from "../src/adapters/openai/openai-conversation-response-composer.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

const profile = parseClinicProfile({
  clinicId: "clinic_1",
  name: "Clinica Demo",
  timezone: "America/Argentina/Buenos_Aires",
  services: [
    {
      id: "svc_botox",
      name: "Botox",
      durationMinutes: 30,
      priceText: "Desde $120.000",
      preparation: "Evitar alcohol 24 horas antes.",
      restrictions: ["No se realiza en embarazo."],
      professionalIds: ["pro_perez"]
    }
  ],
  professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
  appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
  requiredPatientFields: ["fullName"]
});

describe("OpenAIConversationResponseComposer", () => {
  it("rewrites a safe draft reply with conversation context", async () => {
    const client = new FakeOpenAIClient({
      text: "Tengo un lugar el miercoles 3 de junio a las 13:00 para Botox. Si te sirve, lo confirmamos."
    });

    const result = await new OpenAIConversationResponseComposer({
      client,
      model: "gpt-5.5",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).compose({
      clinicProfile: profile,
      conversationState: {
        stage: "idle",
        hasPendingBooking: false,
        pendingBookingKind: "none",
        missingPatientFields: [],
        activeAppointmentCount: 0,
        lastPatientMessage: "me quiero hacer botox"
      },
      understanding: {
        provider: "openai",
        intent: "book",
        confidence: 0.93,
        serviceName: "Botox",
        requestedTopics: [],
        requiresHuman: false,
        reason: "Patient wants to book Botox."
      },
      action: "search_slots",
      patientMessage: "me quiero hacer botox",
      recentMessages: [{ role: "patient", text: "hola", at: new Date("2026-06-03T12:00:00.000Z") }],
      draftText: "Tengo este horario: miercoles 3 de junio a las 13:00 para Botox. Si te sirve, lo confirmamos."
    });

    expect(result).toBe("Tengo un lugar el miercoles 3 de junio a las 13:00 para Botox. Si te sirve, lo confirmamos.");
    expect(client.lastBody?.instructions).toContain("Preserve the exact operational meaning");
    expect(client.lastBody?.reasoning).toEqual({ effort: "medium" });
    expect(JSON.parse(client.lastBody?.input ?? "{}").recentMessages).toHaveLength(1);
    expect(JSON.stringify(client.lastBody)).not.toContain("cal_perez");
  });

  it("returns undefined when OpenAI fails", async () => {
    const result = await new OpenAIConversationResponseComposer({
      client: new ThrowingOpenAIClient(),
      model: "gpt-5.5",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).compose({
      conversationState: {
        stage: "idle",
        hasPendingBooking: false,
        pendingBookingKind: "none",
        missingPatientFields: [],
        activeAppointmentCount: 0,
        lastPatientMessage: "hola"
      },
      understanding: {
        provider: "openai",
        intent: "smalltalk",
        confidence: 0.9,
        requestedTopics: [],
        requiresHuman: false,
        reason: "Greeting."
      },
      action: "reply_non_transactional",
      patientMessage: "hola",
      recentMessages: [],
      draftText: "Hola, te ayudo con turnos."
    });

    expect(result).toBeUndefined();
  });
});

class FakeOpenAIClient {
  lastBody?: any;

  constructor(private readonly parsed: unknown) {}

  responses = {
    parse: async (body: unknown) => {
      this.lastBody = body;
      return { output_parsed: this.parsed };
    }
  };
}

class ThrowingOpenAIClient {
  responses = {
    parse: async () => {
      throw new Error("OpenAI request failed");
    }
  };
}
