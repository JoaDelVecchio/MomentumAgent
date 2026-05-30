import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { FakeWhatsAppProvider } from "../src/adapters/memory/fake-whatsapp-provider.js";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { PrismaOperationalRepository } from "../src/adapters/prisma/operational-repository.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { WhatsAppInboundService } from "../src/application/messaging/whatsapp-inbound-service.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("Prisma-backed runtime persistence", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-prisma-runtime-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("continues a pending booking after replacing repository and workflow instances", async () => {
    const first = await buildRuntime(prisma);
    await first.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Quiero reservar botox"
    });

    const second = await buildRuntime(prisma);
    const confirm = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "si"
    });

    expect(confirm).toEqual({
      kind: "reply",
      text: "Perfecto. Para confirmar el turno, pasame nombre y apellido."
    });

    const final = await second.workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_restart",
      patientId: "pat_restart",
      whatsappNumber: "+5491111116666",
      text: "Ana Gomez"
    });

    expect(final.kind).toBe("reply");
    expect(final.text).toContain("Turno confirmado");
    expect(await second.repos.listAppointmentsByPatient("pat_restart")).toHaveLength(1);
  });

  it("ignores duplicate webhook deliveries after replacing service instances", async () => {
    const first = await buildRuntime(prisma);
    const provider = new FakeWhatsAppProvider();
    const firstService = new WhatsAppInboundService({
      repos: first.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: first.audit
    });

    await firstService.handleInboundMessage(inbound("delivery_restart"));

    const second = await buildRuntime(prisma);
    const secondService = new WhatsAppInboundService({
      repos: second.repos,
      provider,
      workflow: new FixedWorkflow(),
      audit: second.audit
    });
    const duplicate = await secondService.handleInboundMessage(inbound("delivery_restart"));

    expect(duplicate).toEqual({ status: "ignored_duplicate" });
    expect(provider.sentTextMessages).toHaveLength(1);
  });
});

async function buildRuntime(prisma: PrismaClient) {
  const repos = new PrismaOperationalRepository(prisma);
  await repos.upsertClinicProfile(profile());
  const audit = new PrismaAuditLog(prisma);
  const calendar = new FakeCalendar();
  calendar.seedAvailability("cal_perez", [
    { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
  ]);
  const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
  const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date("2026-05-29T12:00:00.000Z"));

  return { repos, audit, calendar, scheduling, workflow };
}

function profile() {
  return parseClinicProfile({
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
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  });
}

function inbound(idempotencyKey: string) {
  return {
    clinicId: "clinic_1",
    providerPhoneNumberId: "123456789012345",
    providerMessageId: "wamid.restart",
    conversationId: "conv_duplicate_restart",
    patientId: "pat_duplicate_restart",
    whatsappNumber: "+5491111117777",
    text: "hola",
    idempotencyKey,
    receivedAt: new Date("2026-05-29T12:00:00.000Z")
  };
}

class FixedWorkflow {
  async handleInboundMessage() {
    return { kind: "reply" as const, text: "Respuesta persistente." };
  }
}
