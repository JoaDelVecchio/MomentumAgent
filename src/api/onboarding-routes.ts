import type { FastifyInstance } from "fastify";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { OnboardingService } from "../application/onboarding/onboarding-service.js";
import {
  OnboardingTestModeError,
  type OnboardingTestModeService
} from "../application/onboarding/test-mode-service.js";
import { parseClinicProfile, type ClinicProfileInput } from "../domain/clinic-profile.js";
import { DomainError } from "../domain/errors.js";
import { isAuthorized } from "./internal-auth.js";

const leadSchema = z.object({
  contactName: z.string().trim().min(1),
  clinicName: z.string().trim().min(1),
  whatsappOrPhone: z.string().trim().min(1),
  city: z.string().trim().min(1),
  country: z.string().trim().min(1),
  professionalCount: z.number().int().positive(),
  currentSchedulingSystem: z.string().trim().min(1),
  monthlyWhatsappInquiries: z.string().trim().min(1),
  mainPain: z.enum([
    "missed_leads",
    "reception_load",
    "reactivation",
    "no_shows",
    "rescheduling",
    "other"
  ])
});

const manualClinicSchema = z.object({
  clinicId: z.string().trim().min(1),
  clinicName: z.string().trim().min(1),
  primaryContactName: z.string().trim().min(1),
  primaryContactPhone: z.string().trim().min(1),
  city: z.string().trim().min(1),
  country: z.string().trim().min(1),
  source: z.enum(["landing", "presencial", "referido", "outbound"]),
  now: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional()
});

const convertLeadSchema = z.object({
  clinicId: z.string().trim().min(1),
  now: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional()
});

const paymentSchema = z.object({
  paymentStatus: z.enum(["unpaid", "paid", "trial", "waived"]),
  now: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional()
});

const readinessSchema = z.object({
  whatsappReady: z.boolean().optional(),
  calendarConnected: z.boolean().optional(),
  testConversationPassed: z.boolean().optional(),
  activationChecklistCompleted: z.boolean().optional(),
  now: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional()
});

const testMessageSchema = z.object({
  text: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).optional(),
  patientId: z.string().trim().min(1).optional(),
  whatsappNumber: z.string().trim().min(1).optional()
});

const leadParamsSchema = z.object({ leadId: z.string().min(1) });
const clinicParamsSchema = z.object({ clinicId: z.string().min(1) });

export type OnboardingRoutesOptions = {
  adminToken: string;
  service: Pick<
    OnboardingService,
    | "submitLead"
    | "listLeads"
    | "createManualClinic"
    | "convertLeadToClinic"
    | "listClinicSetups"
    | "getClinicSetup"
    | "updatePaymentStatus"
    | "updateReadinessFlags"
    | "saveClinicProfile"
    | "readiness"
    | "activateClinic"
    | "pauseClinic"
  >;
  testModeService?: Pick<OnboardingTestModeService, "runMessage">;
};

export function registerOnboardingRoutes(app: FastifyInstance, options: OnboardingRoutesOptions) {
  app.post("/leads", async (request, reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_lead" });
    }

    const lead = await options.service.submitLead(parsed.data);
    return reply.status(201).send({ lead });
  });

  app.get("/internal/onboarding/leads", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return reply.send({ leads: await options.service.listLeads() });
  });

  app.post("/internal/onboarding/clinics", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const parsed = manualClinicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    const setup = await options.service.createManualClinic(parsed.data);
    return reply.status(201).send({ setup });
  });

  app.post("/internal/onboarding/leads/:leadId/convert", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = leadParamsSchema.safeParse(request.params);
    const body = convertLeadSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_conversion" });
    }

    try {
      const setup = await options.service.convertLeadToClinic({ leadId: params.data.leadId, ...body.data });
      return reply.status(201).send({ setup });
    } catch (error) {
      if (isNotFoundError(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.get("/internal/onboarding/clinics", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return reply.send({ clinics: await options.service.listClinicSetups() });
  });

  app.get("/internal/onboarding/clinics/:clinicId", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    const setup = await options.service.getClinicSetup(params.data.clinicId);
    if (!setup) {
      return reply.status(404).send({ error: "not_found" });
    }
    return reply.send({ setup });
  });

  app.patch("/internal/onboarding/clinics/:clinicId/payment", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    const body = paymentSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_payment" });
    }

    try {
      const setup = await options.service.updatePaymentStatus({ clinicId: params.data.clinicId, ...body.data });
      return reply.send({ setup });
    } catch (error) {
      if (isNotFoundError(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.patch("/internal/onboarding/clinics/:clinicId/readiness", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    const body = readinessSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_readiness" });
    }

    try {
      const setup = await options.service.updateReadinessFlags({ clinicId: params.data.clinicId, ...body.data });
      return reply.send({ setup });
    } catch (error) {
      if (isNotFoundError(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.put("/internal/onboarding/clinics/:clinicId/profile", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic_profile" });
    }

    try {
      const body = typeof request.body === "object" && request.body !== null ? request.body : {};
      const profileInput = { ...(body as Record<string, unknown>), clinicId: params.data.clinicId } as ClinicProfileInput;
      const profile = parseClinicProfile(profileInput);
      const savedProfile = await options.service.saveClinicProfile(profile);
      return reply.send({ profile: savedProfile });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof DomainError) {
        return reply.status(400).send({ error: "invalid_clinic_profile" });
      }
      throw error;
    }
  });

  const testModeService = options.testModeService;
  if (testModeService) {
    app.post("/internal/onboarding/clinics/:clinicId/test-message", async (request, reply) => {
      if (!isAuthorized(request.headers.authorization, options.adminToken)) {
        return reply.status(401).send({ error: "unauthorized" });
      }

      const params = clinicParamsSchema.safeParse(request.params);
      const body = testMessageSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({ error: "invalid_test_message" });
      }

      const { clinicId } = params.data;
      try {
        const defaultIdentity = buildDefaultTestIdentity(clinicId);
        const result = await testModeService.runMessage({
          clinicId,
          conversationId: body.data.conversationId ?? defaultIdentity.conversationId,
          patientId: body.data.patientId ?? defaultIdentity.patientId,
          whatsappNumber: body.data.whatsappNumber ?? defaultIdentity.whatsappNumber,
          text: body.data.text
        });
        return reply.send({ result });
      } catch (error) {
        if (error instanceof OnboardingTestModeError) {
          if (error.code === "clinic_setup_missing") {
            return reply.status(404).send({ error: "not_found" });
          }
          if (error.code === "unsafe_test_identity") {
            return reply.status(400).send({ error: "unsafe_test_identity" });
          }
          return reply.status(409).send({ error: error.code });
        }
        throw error;
      }
    });
  }

  app.post("/internal/onboarding/clinics/:clinicId/activate", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    const existing = await options.service.getClinicSetup(params.data.clinicId);
    if (!existing) {
      return reply.status(404).send({ error: "not_found" });
    }

    const readiness = await options.service.readiness(params.data.clinicId);
    if (!readiness.ready) {
      return reply.status(409).send({ error: "clinic_not_ready", missing: readiness.missing });
    }

    try {
      const setup = await options.service.activateClinic({ clinicId: params.data.clinicId });
      return reply.send({ setup });
    } catch (error) {
      if (isNotFoundError(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/internal/onboarding/clinics/:clinicId/pause", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, options.adminToken)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const params = clinicParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_clinic" });
    }

    try {
      const setup = await options.service.pauseClinic({ clinicId: params.data.clinicId });
      return reply.send({ setup });
    } catch (error) {
      if (isNotFoundError(error)) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
}

function buildDefaultTestIdentity(clinicId: string) {
  const runId = randomUUID();
  return {
    conversationId: `test:${clinicId}:${runId}`,
    patientId: `test_patient:${clinicId}:${runId}`,
    whatsappNumber: `+549000${Date.now()}${randomInt(100000, 1000000)}`
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("not found");
}
