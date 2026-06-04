import { describe, expect, it } from "vitest";
import { OpenAIConversationInterpreter } from "../src/adapters/openai/openai-conversation-interpreter.js";
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

describe("OpenAIConversationInterpreter", () => {
  it("returns parsed structured understanding from the OpenAI response", async () => {
    const client = new FakeOpenAIClient({
      intent: "book",
      confidence: 0.92,
      serviceName: "Botox",
      professionalPreference: "Dra. Perez",
      timePreference: "a la tarde",
      normalizedTimePreference: { from: null, to: null, daypart: "afternoon" },
      requestedTopics: ["price"],
      patientFullName: null,
      requiresHuman: false,
      safetyReason: null,
      reason: "Patient asks for price and booking."
    });

    const result = await new OpenAIConversationInterpreter({
      client,
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "Cuanto sale botox y tenes a la tarde?",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile,
      recentMessages: [
        { role: "patient", text: "hola", at: new Date("2026-05-29T11:58:00.000Z") },
        { role: "assistant", text: "Hola, te ayudo con turnos.", at: new Date("2026-05-29T11:58:01.000Z") }
      ]
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "openai",
        intent: "book",
        serviceName: "Botox",
        requestedTopics: ["price"],
        requiresHuman: false
      })
    );
    expect(client.lastBody?.tools).toEqual([]);
    expect(client.lastBody?.instructions).toContain("mixed question plus availability");
    expect(client.lastBody?.instructions).toContain("me quiero hacer botox");
    expect(client.lastBody?.instructions).toContain("requestedTopics professional");
    expect(client.lastBody?.reasoning).toEqual({ effort: "medium" });
    expect(JSON.parse(client.lastBody?.input ?? "{}").recentMessages).toHaveLength(2);
    expect(JSON.stringify(client.lastBody)).not.toContain("cal_perez");
  });

  it("passes pending booking context to OpenAI without calendar identifiers", async () => {
    const client = new FakeOpenAIClient({
      intent: "slot_refinement",
      confidence: 0.91,
      serviceName: null,
      professionalPreference: null,
      timePreference: "a la tarde",
      normalizedTimePreference: { from: null, to: null, daypart: "afternoon" },
      requestedTopics: [],
      patientFullName: null,
      requiresHuman: false,
      safetyReason: null,
      reason: "Patient asks to refine the pending offered slot."
    });

    const result = await new OpenAIConversationInterpreter({
      client,
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "tenes algo a la tarde?",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      },
      conversationState: {
        stage: "offering_slot",
        hasPendingBooking: true,
        pendingBookingKind: "new_booking",
        selectedServiceId: "svc_botox",
        selectedProfessionalId: "pro_perez",
        offeredSlotStartsAt: "2026-06-01T13:00:00.000Z",
        missingPatientFields: ["fullName"],
        activeAppointmentCount: 0,
        lastPatientMessage: "tenes algo a la tarde?"
      }
    });

    expect(result).toEqual(expect.objectContaining({ intent: "slot_refinement" }));
    expect(JSON.parse(client.lastBody?.input ?? "{}").conversationState).toEqual({
      stage: "offering_slot",
      hasPendingBooking: true,
      pendingBookingKind: "new_booking",
      selectedServiceId: "svc_botox",
      selectedProfessionalId: "pro_perez",
      offeredSlotStartsAt: "2026-06-01T13:00:00.000Z",
      missingPatientFields: ["fullName"],
      activeAppointmentCount: 0,
      lastPatientMessage: "tenes algo a la tarde?"
    });
    expect(JSON.stringify(client.lastBody)).toContain("svc_botox");
    expect(JSON.stringify(client.lastBody)).toContain("Botox");
    expect(JSON.stringify(client.lastBody)).toContain("Dra. Perez");
    expect(JSON.stringify(client.lastBody)).not.toContain("cal_perez");
  });

  it("falls back when OpenAI returns invalid structured output", async () => {
    const client = new FakeOpenAIClient(null);
    const result = await new OpenAIConversationInterpreter({
      client,
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "hola",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "fallback",
        intent: "unknown",
        confidence: 0,
        requiresHuman: false
      })
    );
  });

  it("falls back when the OpenAI client throws", async () => {
    const client = new ThrowingOpenAIClient();
    const result = await new OpenAIConversationInterpreter({
      client,
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).interpret({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "hola",
      now: new Date("2026-05-29T12:00:00.000Z"),
      clinicProfile: profile
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "fallback",
        intent: "unknown",
        confidence: 0,
        requiresHuman: false
      })
    );
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
