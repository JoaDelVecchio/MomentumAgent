import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";

describe("local simulation API", () => {
  const simulationNow = new Date("2026-05-29T12:00:00.000Z");

  it("handles a simulated inbound WhatsApp booking message", async () => {
    const app = buildApp({ enableSimulationRoutes: true, simulationNow });

    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1",
        conversationId: "conv_1",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: "reply",
      text: expect.stringContaining("Tengo este horario")
    });
  });

  it("returns audit events from simulated messages", async () => {
    const app = buildApp({ enableSimulationRoutes: true, simulationNow });

    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1",
        conversationId: "conv_audit",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      }
    });

    const response = await app.inject({ method: "GET", url: "/simulate/audit-log" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_audit",
        type: "intent.detected",
        metadata: { intent: "book" }
      })
    ]);
  });

  it("returns 400 for invalid inbound message payloads", async () => {
    const app = buildApp({ enableSimulationRoutes: true, simulationNow });

    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_inbound_message" });
  });

  it("does not mount simulation routes unless explicitly enabled", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1",
        conversationId: "conv_1",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      }
    });

    expect(response.statusCode).toBe(404);
  });
});
