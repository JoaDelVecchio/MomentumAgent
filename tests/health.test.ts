import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";

describe("health endpoint", () => {
  it("returns ok", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
