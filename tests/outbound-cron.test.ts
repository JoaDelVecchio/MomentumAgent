import { describe, expect, it } from "vitest";
import { runOutboundCron } from "../src/runtime/outbound-cron.js";

describe("outbound cron runner", () => {
  it("rejects requests without the Vercel cron secret", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: undefined,
      env: {
        CRON_SECRET: "cron-secret",
        OUTBOUND_AUTOMATION_TOKEN: "outbound-token",
        MOMENTUM_CRON_CLINIC_ID: "clinic_1"
      },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({ statusCode: 401, body: { error: "unauthorized" } });
    expect(runtime.injectCalls).toEqual([]);
  });

  it("requires an outbound token and clinic id after cron auth succeeds", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: "Bearer cron-secret",
      env: { CRON_SECRET: "cron-secret" },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({
      statusCode: 500,
      body: { error: "outbound_cron_not_configured" }
    });
    expect(runtime.injectCalls).toEqual([]);
  });

  it("calls the internal outbound route with the configured clinic id", async () => {
    const runtime = new FakeRuntime();

    const result = await runOutboundCron({
      authorization: "Bearer cron-secret",
      env: {
        CRON_SECRET: "cron-secret",
        OUTBOUND_AUTOMATION_TOKEN: "outbound-token",
        MOMENTUM_CRON_CLINIC_ID: "clinic_1"
      },
      runtimeFactory: async () => runtime
    });

    expect(result).toEqual({
      statusCode: 200,
      body: {
        reminders: { sent: 0, blocked: 0, failed: 0, skipped: 0 },
        reactivations: { sent: 0, blocked: 0, failed: 0, skipped: 0 }
      }
    });
    expect(runtime.injectCalls).toEqual([
      {
        method: "POST",
        url: "/internal/outbound/run",
        headers: { authorization: "Bearer outbound-token" },
        payload: { clinicId: "clinic_1" }
      }
    ]);
  });
});

class FakeRuntime {
  readonly injectCalls: unknown[] = [];
  readonly app = {
    inject: async (input: unknown) => {
      this.injectCalls.push(input);
      return {
        statusCode: 200,
        json: () => ({
          reminders: { sent: 0, blocked: 0, failed: 0, skipped: 0 },
          reactivations: { sent: 0, blocked: 0, failed: 0, skipped: 0 }
        })
      };
    }
  };
}
