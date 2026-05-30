import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditLog } from "../src/adapters/prisma/audit-log.js";
import { createPrismaTestContext, type PrismaTestContext } from "./helpers/prisma.js";

describe("Prisma operational persistence schema", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(() => {
    context = createPrismaTestContext("momentum-operational-schema-");
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("stores processed webhook deliveries with provider-scoped uniqueness", async () => {
    await prisma.clinic.create({
      data: {
        id: "clinic_1",
        name: "Clinica Demo",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });

    await prisma.processedWebhookDelivery.create({
      data: {
        provider: "kapso",
        idempotencyKey: "delivery_1",
        clinicId: "clinic_1",
        conversationId: "conv_1",
        providerMessageId: "wamid.1"
      }
    });

    await expect(
      prisma.processedWebhookDelivery.create({
        data: {
          provider: "kapso",
          idempotencyKey: "delivery_1",
          clinicId: "clinic_1"
        }
      })
    ).rejects.toThrow();
  });
});

describe("PrismaAuditLog", () => {
  let context: PrismaTestContext;
  let prisma: PrismaClient;

  beforeAll(async () => {
    context = createPrismaTestContext("momentum-prisma-audit-");
    prisma = context.prisma;
    await prisma.clinic.create({
      data: {
        id: "clinic_audit",
        name: "Audit Clinic",
        timezone: "America/Argentina/Buenos_Aires",
        minimumNoticeMinutes: 0,
        cancellationNoticeMinutes: 1440,
        bufferMinutes: 0,
        requiredPatientFieldsJson: JSON.stringify(["fullName"])
      }
    });
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it("records audit events and parses metadata on return", async () => {
    const audit = new PrismaAuditLog(prisma);

    const event = await audit.record({
      clinicId: "clinic_audit",
      type: "whatsapp.inbound.accepted",
      message: "Accepted WhatsApp inbound delivery",
      metadata: { idempotencyKey: "delivery_1", provider: "kapso" }
    });

    expect(event).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        clinicId: "clinic_audit",
        type: "whatsapp.inbound.accepted",
        message: "Accepted WhatsApp inbound delivery",
        metadata: { idempotencyKey: "delivery_1", provider: "kapso" },
        createdAt: expect.any(Date)
      })
    );
  });
});
