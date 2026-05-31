import { describe, expect, it } from "vitest";
import { createProductionAppRuntime } from "../src/runtime/production-app.js";

describe("production app runtime", () => {
  it("builds a local runtime without listening on a port", async () => {
    const runtime = await createProductionAppRuntime({
      ...process.env,
      DATABASE_URL: "file:./dev.db",
      CALENDAR_PROVIDER: "fake",
      WHATSAPP_PROVIDER: "",
      MOMENTUM_ADMIN_TOKEN: "",
      OUTBOUND_AUTOMATION_TOKEN: "",
      ENABLE_SIMULATION_API: "false",
      MOMENTUM_RUNTIME_ENV: "development"
    });

    const response = await runtime.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(runtime.summary).toMatchObject({
      runtimeMode: "development",
      database: "sqlite",
      simulationApi: "disabled",
      calendarProvider: "fake",
      whatsappProvider: "disabled"
    });

    await runtime.close();
  });
});
