import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import type {
  ConversationResponseComposer,
  ConversationResponseComposerInput
} from "../src/application/conversations/response-composer.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

function buildContext(options: { responseComposer?: ConversationResponseComposer } = {}) {
  const repos = new InMemoryRepositories();
  const calendar = new FakeCalendar();
  const audit = new InMemoryAuditLog();

  repos.upsertClinicProfile(
    parseClinicProfile({
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
          restrictions: [],
          professionalIds: ["pro_perez"]
        }
      ],
      professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
      appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
      requiredPatientFields: ["fullName"]
    })
  );

  const now = () => new Date("2026-05-29T12:00:00.000Z");
  const scheduling = new SchedulingService(repos, calendar, audit, now);
  const workflow = new ConversationWorkflow(repos, scheduling, audit, now, undefined, {
    responseComposer: options.responseComposer
  });

  return { repos, calendar, audit, workflow };
}

describe("ConversationWorkflow", () => {
  it("offers slots for clear booking intent without asking for personal data first", async () => {
    const { calendar, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Tengo este horario");
    expect(result.text).toContain("10:00");
    expect(result.text).not.toContain("DNI");
  });

  it("can compose a more natural reply and stores the exchange in recent conversation memory", async () => {
    const responseComposer = new FakeResponseComposer(
      "Tengo un lugar el lunes 1 de junio a las 10:00 para Botox. Si te sirve, lo dejamos reservado."
    );
    const { calendar, repos, workflow } = buildContext({ responseComposer });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "me quiero hacer botox"
    });

    const conversation = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" });
    expect(result.text).toBe("Tengo un lugar el lunes 1 de junio a las 10:00 para Botox. Si te sirve, lo dejamos reservado.");
    expect(responseComposer.inputs[0]).toEqual(
      expect.objectContaining({
        action: "search_slots",
        patientMessage: "me quiero hacer botox",
        draftText: expect.stringContaining("Tengo este horario")
      })
    );
    expect(responseComposer.inputs[0]?.recentMessages).toEqual([]);
    expect(conversation?.recentMessages).toEqual([
      expect.objectContaining({ role: "patient", text: "me quiero hacer botox" }),
      expect.objectContaining({ role: "assistant", text: result.text })
    ]);
  });

  it("asks for required patient data before confirming the offered slot", async () => {
    const { calendar, repos, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual({
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z")
    });

    const confirmResult = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "si"
    });

    expect(confirmResult).toEqual({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);

    const nameResult = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Ana Gomez"
    });

    expect(nameResult.kind).toBe("reply");
    expect(nameResult.text).toContain("Turno confirmado");
    expect(nameResult.text).toContain("10:00");
    expect(repos.getPatient("pat_1")?.fullName).toBe("Ana Gomez");
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([
      expect.objectContaining({
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        status: "scheduled"
      })
    ]);
  });

  it("answers service questions during a pending booking without confirming or losing the slot", async () => {
    const { calendar, repos, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });
    const pendingBooking = repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking;

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "cuanto vale"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Botox: precio Desde $120.000."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })?.pendingBooking).toEqual(
      pendingBooking
    );
    expect(repos.getPatient("pat_1")?.fullName).toBeUndefined();
    expect(repos.listAppointmentsByPatient("pat_1")).toEqual([]);
  });

  it("answers natural service FAQ questions without asking the patient to restate the treatment", async () => {
    const { workflow } = buildContext();

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Cuanto sale botox?"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Botox: precio Desde $120.000."
    });
  });

  it("offers a slot for natural service phrasing without explicit reservation keywords", async () => {
    const { calendar, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T15:00:00.000Z"), endsAt: new Date("2026-06-01T15:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Hola, me quiero hacer botox"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Tengo este horario");
    expect(result.text).toContain("12:00");
    expect(result.text).toContain("Botox");
  });

  it("confirms immediately when required patient data already exists", async () => {
    const { calendar, repos, workflow } = buildContext();
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    await expect(
      workflow.handleInboundMessage({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "confirmo"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "reply",
        text: expect.stringContaining("Turno confirmado")
      })
    );
  });

  it("recognizes common service aliases without onboarding aliases", async () => {
    const { calendar, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar toxina botulinica"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("para Botox");
  });

  it("creates or updates the patient and conversation, then audits the detected intent", async () => {
    const { audit, calendar, repos, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero un turno para botox"
    });

    expect(repos.getPatient("pat_1")).toEqual({
      id: "pat_1",
      whatsappNumber: "+5491111111111"
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).toEqual(
      expect.objectContaining({
        id: "conv_1",
        clinicId: "clinic_1",
        patientId: "pat_1",
        botPaused: false
      })
    );
    expect(await audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "intent.detected",
        metadata: expect.objectContaining({ intent: "book", provider: "rules" })
      })
    );
    expect(await audit.list()).toContainEqual(
      expect.objectContaining({
        clinicId: "clinic_1",
        conversationId: "conv_1",
        type: "agent.decision",
        metadata: expect.objectContaining({
          action: "search_slots",
          stage: "idle"
        })
      })
    );
  });

  it("pauses the bot in the same chat when the patient asks for a human", async () => {
    const { audit, repos, workflow } = buildContext();

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero hablar con una persona"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat."
    });
    expect(repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_1" })).toEqual(
      expect.objectContaining({
        id: "conv_1",
        botPaused: true
      })
    );
    expect(await audit.list()).toContainEqual(
      expect.objectContaining({
        conversationId: "conv_1",
        type: "intent.detected",
        metadata: expect.objectContaining({ intent: "handoff", provider: "rules" })
      })
    );
  });

  it("keeps the bot paused after handoff for later messages in the same chat", async () => {
    const { calendar, workflow } = buildContext();
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero hablar con una persona"
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(result).toEqual({
      kind: "handoff",
      text: "Recepcion continua la conversacion por este mismo chat."
    });
  });

  it("asks for a configured treatment when booking intent names an unknown service", async () => {
    const { workflow } = buildContext();

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar limpieza facial"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No encontre ese tratamiento. Por ahora puedo ayudarte con: Botox."
    });
  });

  it("returns a useful no-availability prompt for a known booking service", async () => {
    const { workflow } = buildContext();

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Necesito turno para botox"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "No encontre horarios disponibles para Botox esta semana. Te aviso si se libera un turno o podes decirme otro dia."
    });
  });

  it("returns useful prompts for cancel and reschedule intents", async () => {
    const { workflow } = buildContext();

    await expect(
      workflow.handleInboundMessage({
        clinicId: "clinic_1",
        conversationId: "conv_cancel",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Necesito cancelar mi turno"
      })
    ).resolves.toEqual({
      kind: "reply",
      text: "No encontre un unico turno activo para cancelar. Pasame dia y horario y lo reviso."
    });

    await expect(
      workflow.handleInboundMessage({
        clinicId: "clinic_1",
        conversationId: "conv_reschedule",
        patientId: "pat_1",
        whatsappNumber: "+5491111111111",
        text: "Quiero reprogramar mi turno"
      })
    ).resolves.toEqual({
      kind: "reply",
      text: "No encontre un unico turno activo para reprogramar. Pasame dia y horario y lo reviso."
    });
  });

  it("cancels the only scheduled appointment from chat", async () => {
    const { calendar, repos, workflow } = buildContext();
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);
    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });
    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "si"
    });

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Necesito cancelar mi turno"
    });

    expect(result.kind).toBe("reply");
    expect(result.text).toContain("Turno cancelado");
    expect(result.text).toContain("10:00");
    expect(repos.listAppointmentsByPatient("pat_1")[0]?.status).toBe("cancelled");
  });

  it("offers and confirms a reschedule for the only scheduled appointment", async () => {
    const { calendar, repos, workflow } = buildContext();
    repos.upsertPatient({ id: "pat_1", whatsappNumber: "+5491111111111", fullName: "Ana Gomez" });
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") },
      { startsAt: new Date("2026-06-02T14:00:00.000Z"), endsAt: new Date("2026-06-02T14:30:00.000Z") }
    ]);
    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });
    await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "si"
    });

    const offer = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Quiero reprogramar mi turno"
    });

    expect(offer.kind).toBe("reply");
    expect(offer.text).toContain("Tengo este nuevo horario");
    expect(offer.text).toContain("11:00");

    const confirmation = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "si"
    });

    expect(confirmation.kind).toBe("reply");
    expect(confirmation.text).toContain("Turno reprogramado");
    expect(confirmation.text).toContain("11:00");
    expect(repos.listAppointmentsByPatient("pat_1")[0]?.startsAt).toEqual(new Date("2026-06-02T14:00:00.000Z"));
  });

  it("replies with a fallback for general questions", async () => {
    const { workflow } = buildContext();

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      patientId: "pat_1",
      whatsappNumber: "+5491111111111",
      text: "Cuanto dura el tratamiento?"
    });

    expect(result).toEqual({
      kind: "reply",
      text: "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno."
    });
  });
});

class FakeResponseComposer implements ConversationResponseComposer {
  inputs: ConversationResponseComposerInput[] = [];

  constructor(private readonly response: string | undefined) {}

  async compose(input: ConversationResponseComposerInput) {
    this.inputs.push(input);
    return this.response;
  }
}
