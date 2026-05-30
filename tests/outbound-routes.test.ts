import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { OutboundAutomationSummary } from "../src/application/outbound/outbound-automation-service.js";
import { readOutboundConfig } from "../src/config/outbound.js";

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

  it.each([
    "Bearer wrong",
    "Bearer ",
    "Basic secret",
    "secret",
    ["Bearer secret", "Bearer wrong"]
  ])("rejects run requests with malformed or incorrect authorization %j", async (authorization) => {
    const app = buildApp({
      outboundAutomation: { token: "secret", service: new FakeOutboundAutomationService() }
    });
    const headers = { authorization: authorization as unknown as string };

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers,
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

  it("accepts a case-insensitive bearer authorization scheme", async () => {
    const service = new FakeOutboundAutomationService();
    const app = buildApp({
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reminders: { sent: 1, blocked: 0, failed: 0, skipped: 0 },
      reactivations: { sent: 2, blocked: 0, failed: 0, skipped: 0 }
    });

    await app.close();
  });

  it.each([null, 0, "not-a-date"])(
    "rejects invalid run request now payload %j",
    async (now) => {
      const app = buildApp({
        outboundAutomation: { token: "secret", service: new FakeOutboundAutomationService() }
      });

      const response = await app.inject({
        method: "POST",
        url: "/internal/outbound/run",
        headers: { authorization: "Bearer secret" },
        payload: { clinicId: "clinic_1", now }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_outbound_run_request" });

      await app.close();
    }
  );

  it("skips reminders when reminders are disabled", async () => {
    const service = new FakeOutboundAutomationService();
    const app = buildApp({
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: {
        clinicId: "clinic_1",
        now: "2026-06-02T12:00:00.000Z",
        reminders: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reminders: zeroSummary,
      reactivations: { sent: 2, blocked: 0, failed: 0, skipped: 0 }
    });
    expect(service.calls).toEqual([
      "reactivations:clinic_1:2026-06-02T12:00:00.000Z"
    ]);

    await app.close();
  });

  it("skips reactivations when reactivations are disabled", async () => {
    const service = new FakeOutboundAutomationService();
    const app = buildApp({
      outboundAutomation: { token: "secret", service }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: {
        clinicId: "clinic_1",
        now: "2026-06-02T12:00:00.000Z",
        reactivations: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reminders: { sent: 1, blocked: 0, failed: 0, skipped: 0 },
      reactivations: zeroSummary
    });
    expect(service.calls).toEqual([
      "reminders:clinic_1:2026-06-02T12:00:00.000Z"
    ]);

    await app.close();
  });

  it("does not register the run route when outbound automation is omitted", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/run",
      headers: { authorization: "Bearer secret" },
      payload: { clinicId: "clinic_1", now: "2026-06-02T12:00:00.000Z" }
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});

describe("outbound automation config", () => {
  it("trims surrounding whitespace from real tokens", () => {
    expect(readOutboundConfig({ OUTBOUND_AUTOMATION_TOKEN: "  secret  " })).toEqual({
      enabled: true,
      token: "secret"
    });
  });

  it("disables outbound automation for whitespace-only tokens", () => {
    expect(readOutboundConfig({ OUTBOUND_AUTOMATION_TOKEN: "   \n\t  " })).toEqual({
      enabled: false
    });
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
