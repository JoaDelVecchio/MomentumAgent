import { describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { buildApp } from "../src/api/app.js";
import { buildDemoClinicProfile } from "../src/dev/demo-clinic-profile.js";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarSlot,
  FindFreeSlotsInput
} from "../src/ports/calendar.js";
import { CalendarInfrastructureError } from "../src/ports/calendar.js";

class TrackingCalendar extends FakeCalendar {
  readonly createEventInputs: CalendarEventInput[] = [];

  override async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    this.createEventInputs.push(input);
    return super.createEvent(input);
  }
}

class FailingCreateCalendar extends FakeCalendar {
  override async findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]> {
    return [
      {
        calendarId: input.calendarIds[0] ?? "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z")
      }
    ];
  }

  override async createEvent(_input: CalendarEventInput): Promise<CalendarEvent> {
    throw new CalendarInfrastructureError("Google Calendar credentials not found for clinic clinic_1");
  }
}

describe("local simulation API", () => {
  const simulationNow = new Date("2026-05-29T12:00:00.000Z");

  it("uses the shared demo clinic profile for simulation", () => {
    const profile = buildDemoClinicProfile();

    expect(profile.clinicId).toBe("clinic_1");
    expect(profile.professionals[0]).toEqual(
      expect.objectContaining({
        id: "pro_perez",
        calendarId: "cal_perez"
      })
    );
  });

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

  it("asks for required patient data before simulated booking confirmation", async () => {
    const app = buildApp({ enableSimulationRoutes: true, simulationNow });
    const basePayload = {
      clinicId: "clinic_1",
      conversationId: "conv_confirm",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111"
    };

    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Quiero reservar botox" }
    });

    const confirmResponse = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "si" }
    });

    expect(confirmResponse.json()).toEqual({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });

    const nameResponse = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Ana Gomez" }
    });

    expect(nameResponse.json()).toEqual({
      kind: "reply",
      text: "Turno confirmado para 2026-06-01T13:00:00.000Z. Te vamos a enviar el recordatorio antes del turno."
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
        metadata: expect.objectContaining({ intent: "book", provider: "rules" })
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

  it("uses the injected Google calendar provider for simulated bookings", async () => {
    const calendar = new TrackingCalendar();
    const app = buildApp({
      enableSimulationRoutes: true,
      simulationNow,
      calendarProvider: "google",
      simulationCalendar: calendar
    });
    const basePayload = {
      clinicId: "clinic_1",
      conversationId: "conv_google_provider",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111"
    };

    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Quiero reservar botox" }
    });
    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "si" }
    });
    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Ana Gomez" }
    });

    expect(response.statusCode).toBe(200);
    expect(calendar.createEventInputs).toEqual([
      expect.objectContaining({
        calendarId: "cal_perez",
        metadata: expect.objectContaining({ patientId: "pat_1" })
      })
    ]);
  });

  it("returns a clear infrastructure error when Google provider is selected without credentials", async () => {
    const app = buildApp({
      enableSimulationRoutes: true,
      simulationNow,
      calendarProvider: "google"
    });

    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: {
        clinicId: "clinic_1",
        conversationId: "conv_google_missing_credentials",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reservar botox"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "calendar_provider_not_configured",
      message: "Google Calendar provider is selected but not configured"
    });
  });

  it("returns a clear infrastructure error when Google booking confirmation loses credentials", async () => {
    const app = buildApp({
      enableSimulationRoutes: true,
      simulationNow,
      calendarProvider: "google",
      simulationCalendar: new FailingCreateCalendar()
    });
    const basePayload = {
      clinicId: "clinic_1",
      conversationId: "conv_google_confirm_missing_credentials",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111"
    };

    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Quiero reservar botox" }
    });
    await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "si" }
    });
    const response = await app.inject({
      method: "POST",
      url: "/simulate/inbound-message",
      payload: { ...basePayload, text: "Ana Gomez" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "calendar_provider_not_configured",
      message: "Google Calendar credentials not found for clinic clinic_1"
    });
  });
});
