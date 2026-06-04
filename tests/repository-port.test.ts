import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type {
  ConversationByPatientLookup,
  ConversationLookup,
  ClaimSlotLockInput,
  ListActiveSlotLocksInput,
  ListScheduledAppointmentsInput,
  OperationalRepository,
  OutboundDeliveryClaimInput,
  ProcessedWebhookDeliveryInput,
  SlotLockMutationInput,
  WebhookDeliveryOutcomeInput
} from "../src/ports/repositories.js";

describe("OperationalRepository port", () => {
  it("allows workflow services to use an async repository implementation", async () => {
    const base = new InMemoryRepositories();
    const repos = new AsyncRepositoryAdapter(base);
    const audit = new InMemoryAuditLog();
    const calendar = new FakeCalendar();

    await repos.upsertClinicProfile(
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
    calendar.seedAvailability("cal_perez", [
      { startsAt: new Date("2026-06-01T13:00:00.000Z"), endsAt: new Date("2026-06-01T13:30:00.000Z") }
    ]);

    const scheduling = new SchedulingService(repos, calendar, audit, () => new Date("2026-05-29T12:00:00.000Z"));
    const workflow = new ConversationWorkflow(repos, scheduling, audit, () => new Date("2026-05-29T12:00:00.000Z"));

    const result = await workflow.handleInboundMessage({
      clinicId: "clinic_1",
      conversationId: "conv_async",
      patientId: "pat_async",
      whatsappNumber: "+5491111111111",
      text: "Quiero reservar botox"
    });

    expect(result.kind).toBe("reply");
    expect((await repos.getConversation({ clinicId: "clinic_1", conversationId: "conv_async" }))?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
    expect(repos.conversationLockCalls).toEqual(["clinic_1:conv_async"]);
  });

  it("supports async slot lock operations", async () => {
    const repos = new AsyncRepositoryAdapter(new InMemoryRepositories());
    await repos.upsertClinicProfile(
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

    const lock = await repos.claimSlotLock({
      clinicId: "clinic_1",
      conversationId: "conv_1",
      serviceId: "svc_botox",
      professionalId: "pro_perez",
      calendarId: "cal_perez",
      startsAt: new Date("2026-06-01T13:00:00.000Z"),
      endsAt: new Date("2026-06-01T13:30:00.000Z"),
      expiresAt: new Date("2026-06-01T13:10:00.000Z"),
      now: new Date("2026-06-01T13:00:00.000Z")
    });

    expect(lock).toEqual(expect.objectContaining({ id: expect.any(String), status: "active" }));
    await expect(
      repos.claimSlotLock({
        clinicId: "clinic_1",
        conversationId: "conv_2",
        serviceId: "svc_botox",
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-01T13:00:00.000Z"),
        endsAt: new Date("2026-06-01T13:30:00.000Z"),
        expiresAt: new Date("2026-06-01T13:10:00.000Z"),
        now: new Date("2026-06-01T13:00:00.000Z")
      })
    ).resolves.toBeUndefined();

    expect(
      await repos.listActiveSlotLocks({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T13:00:00.000Z"),
        to: new Date("2026-06-01T13:30:00.000Z"),
        now: new Date("2026-06-01T13:00:00.000Z")
      })
    ).toHaveLength(1);

    await repos.releaseSlotLock({ lockId: lock!.id, now: new Date("2026-06-01T13:01:00.000Z") });
    expect(
      await repos.listActiveSlotLocks({
        clinicId: "clinic_1",
        from: new Date("2026-06-01T13:00:00.000Z"),
        to: new Date("2026-06-01T13:30:00.000Z"),
        now: new Date("2026-06-01T13:01:00.000Z")
      })
    ).toEqual([]);
  });
});

class AsyncRepositoryAdapter implements OperationalRepository {
  readonly conversationLockCalls: string[] = [];

  constructor(private readonly inner: InMemoryRepositories) {}

  async upsertClinicProfile(input: Parameters<InMemoryRepositories["upsertClinicProfile"]>[0]) {
    return this.inner.upsertClinicProfile(input);
  }

  async getClinicProfile(input: string) {
    return this.inner.getClinicProfile(input);
  }

  async upsertPatient(input: Parameters<InMemoryRepositories["upsertPatient"]>[0]) {
    return this.inner.upsertPatient(input);
  }

  async getPatient(input: string) {
    return this.inner.getPatient(input);
  }

  async saveConversation(input: Parameters<InMemoryRepositories["saveConversation"]>[0]) {
    return this.inner.saveConversation(input);
  }

  async getConversation(input: ConversationLookup) {
    return this.inner.getConversation(input);
  }

  async saveAppointment(input: Parameters<InMemoryRepositories["saveAppointment"]>[0]) {
    return this.inner.saveAppointment(input);
  }

  async nextAppointmentId() {
    return this.inner.nextAppointmentId();
  }

  async claimSlotLock(input: ClaimSlotLockInput) {
    return this.inner.claimSlotLock(input);
  }

  async listActiveSlotLocks(input: ListActiveSlotLocksInput) {
    return this.inner.listActiveSlotLocks(input);
  }

  async releaseSlotLock(input: SlotLockMutationInput) {
    return this.inner.releaseSlotLock(input);
  }

  async consumeSlotLock(input: SlotLockMutationInput) {
    return this.inner.consumeSlotLock(input);
  }

  async withAppointmentLock<T>(appointmentId: string, operation: () => Promise<T>) {
    return this.inner.withAppointmentLock(appointmentId, operation);
  }

  async withConversationLock<T>(conversationId: string, operation: () => Promise<T>) {
    this.conversationLockCalls.push(conversationId);
    return this.inner.withConversationLock(conversationId, operation);
  }

  async withWebhookDeliveryLock<T>(idempotencyKey: string, operation: () => Promise<T>) {
    return this.inner.withWebhookDeliveryLock(idempotencyKey, operation);
  }

  async getAppointment(input: string) {
    return this.inner.getAppointment(input);
  }

  async listAppointmentsByPatient(input: string) {
    return this.inner.listAppointmentsByPatient(input);
  }

  async listScheduledAppointments(input: ListScheduledAppointmentsInput) {
    return this.inner.listScheduledAppointments(input);
  }

  async listConversationsByClinic(input: string) {
    return this.inner.listConversationsByClinic(input);
  }

  async listConversationsByPatient(input: ConversationByPatientLookup) {
    return this.inner.listConversationsByPatient(input);
  }

  async saveInterest(input: Parameters<InMemoryRepositories["saveInterest"]>[0]) {
    return this.inner.saveInterest(input);
  }

  async listActiveInterests() {
    return this.inner.listActiveInterests();
  }

  async markOptOut(input: string) {
    return this.inner.markOptOut(input);
  }

  async isOptedOut(input: string) {
    return this.inner.isOptedOut(input);
  }

  async claimWebhookDelivery(input: ProcessedWebhookDeliveryInput) {
    return this.inner.claimWebhookDelivery(input);
  }

  async releaseWebhookDeliveryClaim(input: ProcessedWebhookDeliveryInput) {
    return this.inner.releaseWebhookDeliveryClaim(input);
  }

  async getWebhookDelivery(input: string) {
    return this.inner.getWebhookDelivery(input);
  }

  async saveWebhookDeliveryOutcome(input: WebhookDeliveryOutcomeInput) {
    return this.inner.saveWebhookDeliveryOutcome(input);
  }

  async markWebhookDeliveryReadyForRetry(input: ProcessedWebhookDeliveryInput) {
    return this.inner.markWebhookDeliveryReadyForRetry(input);
  }

  async hasProcessedWebhookDelivery(input: string) {
    return this.inner.hasProcessedWebhookDelivery(input);
  }

  async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
    return this.inner.markProcessedWebhookDelivery(input);
  }

  async claimOutboundDelivery(input: OutboundDeliveryClaimInput) {
    return this.inner.claimOutboundDelivery(input);
  }

  async getOutboundDelivery(input: string) {
    return this.inner.getOutboundDelivery(input);
  }

  async markOutboundDeliverySent(input: Parameters<InMemoryRepositories["markOutboundDeliverySent"]>[0]) {
    return this.inner.markOutboundDeliverySent(input);
  }

  async markOutboundDeliveryBlocked(input: Parameters<InMemoryRepositories["markOutboundDeliveryBlocked"]>[0]) {
    return this.inner.markOutboundDeliveryBlocked(input);
  }

  async markOutboundDeliveryFailed(input: Parameters<InMemoryRepositories["markOutboundDeliveryFailed"]>[0]) {
    return this.inner.markOutboundDeliveryFailed(input);
  }
}
