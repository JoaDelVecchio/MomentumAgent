import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ProductionAppRuntime } from "../src/runtime/production-app.js";
import {
  createVercelFastifyHandler,
  stripVercelApiPrefix
} from "../src/runtime/vercel-fastify-handler.js";

describe("Vercel Fastify handler", () => {
  it.each([
    ["/api", "/"],
    ["/api?x=1", "/?x=1"],
    ["/api/health", "/health"],
    ["/api/webhooks/whatsapp/kapso", "/webhooks/whatsapp/kapso"],
    ["/api/internal/outbound/run?x=1", "/internal/outbound/run?x=1"],
    ["/health", "/health"],
    [undefined, undefined]
  ])("strips only the leading /api prefix from %s", (input, expected) => {
    expect(stripVercelApiPrefix(input)).toBe(expected);
  });

  it("restores deep rewritten routes from the explicit Vercel handler path", () => {
    expect(
      stripVercelApiPrefix(
        "/api/handler?__momentum_path=%2Finternal%2Fonboarding%2Fclinics%2Fclinic_1%2Fgoogle-calendar%2Fstatus&googleCalendar=connected"
      )
    ).toBe(
      "/internal/onboarding/clinics/clinic_1/google-calendar/status?googleCalendar=connected"
    );
  });

  it("retries runtime initialization after a rejected factory call", async () => {
    const ready = vi.fn(async () => undefined);
    const emit = vi.fn();
    const runtime = {
      app: {
        ready,
        server: { emit }
      }
    } as unknown as ProductionAppRuntime;
    const runtimeFactory = vi
      .fn<() => Promise<ProductionAppRuntime>>()
      .mockRejectedValueOnce(new Error("transient setup failure"))
      .mockResolvedValueOnce(runtime);
    const handler = createVercelFastifyHandler(runtimeFactory);

    await expect(handler(request("/api/health"), response())).rejects.toThrow("transient setup failure");
    const retryRequest = request("/api/health");
    const retryResponse = response();
    await handler(retryRequest, retryResponse);

    expect(runtimeFactory).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(retryRequest.url).toBe("/health");
    expect(emit).toHaveBeenCalledWith("request", retryRequest, retryResponse);
  });
});

function request(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function response(): ServerResponse {
  return {} as ServerResponse;
}
