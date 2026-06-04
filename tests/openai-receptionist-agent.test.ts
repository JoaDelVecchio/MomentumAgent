import { describe, expect, it } from "vitest";
import { OpenAIReceptionistAgent } from "../src/adapters/openai/openai-receptionist-agent.js";
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

describe("OpenAIReceptionistAgent", () => {
  it("returns a parsed receptionist turn and sends grounded clinic context", async () => {
    const client = new FakeOpenAIClient({
      replyDraft: "Botox esta desde $120.000. Te mantengo el jueves a las 09:00; si queres, te lo confirmo.",
      proposedAction: "answer_business_question",
      confidence: 0.94,
      serviceName: "Botox",
      professionalPreference: null,
      timePreference: null,
      normalizedTimePreference: { from: "2026-06-09T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", daypart: null },
      requestedTopics: ["price"],
      patientFullName: null,
      needsHuman: false,
      safetyReason: null,
      reason: "The patient asks the price while a Botox slot is pending.",
      grounding: ["Botox priceText is configured."],
      missingFacts: []
    });

    const result = await new OpenAIReceptionistAgent({
      client,
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).respond({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "cuanto esta?",
      now: new Date("2026-06-04T12:00:00.000Z"),
      clinicProfile: profile,
      pendingBooking: {
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-04T12:00:00.000Z"),
        endsAt: new Date("2026-06-04T12:30:00.000Z")
      },
      conversationState: {
        stage: "offering_slot",
        hasPendingBooking: true,
        pendingBookingKind: "new_booking",
        selectedServiceId: "svc_botox",
        selectedProfessionalId: "pro_perez",
        offeredSlotStartsAt: "2026-06-04T12:00:00.000Z",
        missingPatientFields: ["fullName"],
        activeAppointmentCount: 0,
        lastPatientMessage: "cuanto esta?"
      },
      activeAppointments: [],
      recentMessages: [{ role: "assistant", text: "Tengo un lugar el jueves a las 09:00.", at: new Date("2026-06-04T11:59:00.000Z") }]
    });

    expect(result).toEqual(
      expect.objectContaining({
        proposedAction: "answer_business_question",
        serviceName: "Botox",
        normalizedTimePreference: {
          from: new Date("2026-06-09T00:00:00.000Z"),
          to: new Date("2026-06-10T00:00:00.000Z")
        },
        requestedTopics: ["price"]
      })
    );
    expect(client.lastBody?.instructions).toContain("recepcion de la clinica");
    expect(client.lastBody?.instructions).toContain("sentido comun administrativo");
    expect(client.lastBody?.instructions).toContain("No inventes");
    expect(client.lastBody?.reasoning).toEqual({ effort: "medium" });

    const payload = JSON.parse(client.lastBody?.input ?? "{}");
    expect(payload.conversationState.stage).toBe("offering_slot");
    expect(payload.pendingBooking.serviceName).toBe("Botox");
    expect(payload.clinicProfile.services[0]).toEqual(
      expect.objectContaining({
        name: "Botox",
        priceText: "Desde $120.000",
        professionals: ["Dra. Perez"]
      })
    );
    expect(JSON.stringify(client.lastBody)).not.toContain("cal_perez");
  });

  it("returns a safe receptionist fallback when OpenAI fails", async () => {
    const result = await new OpenAIReceptionistAgent({
      client: new ThrowingOpenAIClient(),
      model: "gpt-5-mini",
      timeoutMs: 500,
      reasoningEffort: "medium"
    }).respond({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      messageText: "hola",
      now: new Date("2026-06-04T12:00:00.000Z"),
      conversationState: {
        stage: "idle",
        hasPendingBooking: false,
        pendingBookingKind: "none",
        missingPatientFields: [],
        activeAppointmentCount: 0,
        lastPatientMessage: "hola"
      },
      activeAppointments: [],
      recentMessages: []
    });

    expect(result).toEqual(
      expect.objectContaining({
        proposedAction: "reply_only",
        confidence: 0,
        needsHuman: false
      })
    );
    expect(result.replyDraft).toContain("recepcion");
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
