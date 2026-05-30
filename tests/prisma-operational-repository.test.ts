import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
