import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { OutboundAutomationSummary } from "../src/application/outbound/outbound-automation-service.js";

const zeroSummary: OutboundAutomationSummary = { sent: 0, blocked: 0, failed: 0, skipped: 0 };

describe("outbound automation internal routes", () => {
  it("rejects run requests without the configured bearer token", async () => {
    const app = buildApp({
      outboundAutomation: { token: "secret", service: new FakeOutboundAutomationService() }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });

    await app.close();
  });

  it("runs due reminders and reactivations with the configured bearer token", async () => {
    const service = new FakeOutboundAutomationService();
    const app = buildApp({
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reminders: { sent: 1, blocked: 0, failed: 0, skipped: 0 },
      reactivations: { sent: 2, blocked: 0, failed: 0, skipped: 0 }
    });
    expect(service.calls).toEqual([
      "reminders:clinic_1:2026-06-02T12:00:00.000Z",
      "reactivations:clinic_1:2026-06-02T12:00:00.000Z"
    ]);

    await app.close();
  });
});

class FakeOutboundAutomationService {
  readonly calls: string[] = [];

  async runDueReminders(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reminders:${input.clinicId}:${input.now.toISOString()}`);
    return { ...zeroSummary, sent: 1 };
  }

  async runDueReactivations(input: { clinicId: string; now: Date }): Promise<OutboundAutomationSummary> {
    this.calls.push(`reactivations:${input.clinicId}:${input.now.toISOString()}`);
    return { ...zeroSummary, sent: 2 };
  }
}
