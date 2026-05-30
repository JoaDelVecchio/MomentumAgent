import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../src/adapters/memory/audit-log.js";
import { FakeCalendar } from "../src/adapters/memory/fake-calendar.js";
import { InMemoryRepositories } from "../src/adapters/memory/repositories.js";
import { ConversationWorkflow } from "../src/application/conversations/conversation-workflow.js";
import { SchedulingService } from "../src/application/scheduling/scheduling-service.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";
import type { OperationalRepository, ProcessedWebhookDeliveryInput } from "../src/ports/repositories.js";

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
    expect((await repos.getConversation("conv_async"))?.pendingBooking).toEqual(
      expect.objectContaining({ serviceId: "svc_botox" })
    );
    expect(repos.conversationLockCalls).toEqual(["conv_async"]);
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

  async getConversation(input: string) {
    return this.inner.getConversation(input);
  }

  async saveAppointment(input: Parameters<InMemoryRepositories["saveAppointment"]>[0]) {
    return this.inner.saveAppointment(input);
  }

  async nextAppointmentId() {
    return this.inner.nextAppointmentId();
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

  async hasProcessedWebhookDelivery(input: string) {
    return this.inner.hasProcessedWebhookDelivery(input);
  }

  async markProcessedWebhookDelivery(input: string | ProcessedWebhookDeliveryInput) {
    return this.inner.markProcessedWebhookDelivery(input);
  }
}
