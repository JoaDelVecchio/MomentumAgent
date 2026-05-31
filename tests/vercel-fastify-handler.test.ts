import { describe, expect, it } from "vitest";
import { stripVercelApiPrefix } from "../src/runtime/vercel-fastify-handler.js";

describe("Vercel Fastify handler", () => {
  it.each([
    ["/api/health", "/health"],
    ["/api/webhooks/whatsapp/kapso", "/webhooks/whatsapp/kapso"],
    ["/api/internal/outbound/run?x=1", "/internal/outbound/run?x=1"],
    ["/health", "/health"],
    [undefined, undefined]
  ])("strips only the leading /api prefix from %s", (input, expected) => {
    expect(stripVercelApiPrefix(input)).toBe(expected);
  });
});
