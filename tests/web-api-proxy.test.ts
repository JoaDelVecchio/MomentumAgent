import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../apps/web/src/app/api/backend/[...path]/route.js";
import { adminHeaders, apiJson } from "../apps/web/src/lib/api.js";

const originalMomentumApiBaseUrl = process.env.MOMENTUM_API_BASE_URL;
const originalNextPublicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnv("MOMENTUM_API_BASE_URL", originalMomentumApiBaseUrl);
  restoreEnv("NEXT_PUBLIC_API_BASE_URL", originalNextPublicApiBaseUrl);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("web API proxy", () => {
  it("uses a same-origin API base for browser helpers", async () => {
    const apiSource = await readFile("apps/web/src/lib/api.ts", "utf8");

    expect(apiSource).toContain('export const apiBaseUrl = "/api/backend";');
    expect(apiSource).not.toContain('export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL');
    expect(apiSource).not.toContain("http://127.0.0.1:3000");
  });

  it("proxies JSON lead submissions to the backend and forwards required headers", async () => {
    const observed = await withBackendServer(async (baseUrl, requests) => {
      process.env.MOMENTUM_API_BASE_URL = baseUrl;
      delete process.env.NEXT_PUBLIC_API_BASE_URL;

      const response = await POST(
        new Request("http://127.0.0.1:3001/api/backend/leads?source=landing", {
          method: "POST",
          headers: {
            authorization: "Bearer setup-token",
            "content-type": "application/json",
            "x-ignored": "not-forwarded"
          },
          body: JSON.stringify({ clinicName: "Derma Sur" })
        }),
        { params: Promise.resolve({ path: ["leads"] }) }
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ ok: true });
      return requests[0];
    });

    expect(observed).toEqual({
      method: "POST",
      url: "/leads?source=landing",
      authorization: "Bearer setup-token",
      contentType: "application/json",
      ignoredHeader: undefined,
      body: '{"clinicName":"Derma Sur"}'
    });
  });

  it("proxies Google calendar onboarding start responses", async () => {
    const observed = await withBackendServer(async (baseUrl, requests) => {
      process.env.MOMENTUM_API_BASE_URL = baseUrl;
      delete process.env.NEXT_PUBLIC_API_BASE_URL;

      const response = await POST(
        new Request(
          "http://127.0.0.1:3001/api/backend/internal/onboarding/clinics/clinic_1/google-calendar/start",
          {
            method: "POST",
            headers: {
              authorization: "Bearer secret",
              "content-type": "application/json"
            },
            body: JSON.stringify({})
          }
        ),
        {
          params: Promise.resolve({
            path: ["internal", "onboarding", "clinics", "clinic_1", "google-calendar", "start"]
          })
        }
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ ok: true });
      return requests[0];
    });

    expect(observed).toEqual({
      method: "POST",
      url: "/internal/onboarding/clinics/clinic_1/google-calendar/start",
      authorization: "Bearer secret",
      contentType: "application/json",
      ignoredHeader: undefined,
      body: "{}"
    });
  });

  it("sends an empty JSON body for Google calendar start requests without a payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await apiJson("/internal/onboarding/clinics/clinic_1/google-calendar/start", {
      method: "POST",
      headers: adminHeaders("secret")
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/internal/onboarding/clinics/clinic_1/google-calendar/start",
      expect.objectContaining({
        method: "POST",
        body: "{}"
      })
    );
  });

  it("rejects dot-segment proxy paths before they can escape the backend base path", async () => {
    const observed = await withBackendServer(async (baseUrl, requests) => {
      process.env.MOMENTUM_API_BASE_URL = `${baseUrl}/base/`;
      delete process.env.NEXT_PUBLIC_API_BASE_URL;

      const response = await POST(
        new Request("http://127.0.0.1:3001/api/backend/../internal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clinicName: "Derma Sur" })
        }),
        { params: Promise.resolve({ path: ["..", "internal"] }) }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_proxy_path" });
      return requests;
    });

    expect(observed).toEqual([]);
  });
});

type ObservedRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  ignoredHeader: string | undefined;
  body: string;
};

async function withBackendServer<T>(
  callback: (baseUrl: string, requests: ObservedRequest[]) => Promise<T>
): Promise<T> {
  const requests: ObservedRequest[] = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: header(request, "authorization"),
      contentType: header(request, "content-type"),
      ignoredHeader: header(request, "x-ignored"),
      body: await readBody(request)
    });
    response.statusCode = 201;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected backend server to listen on a TCP port");
    }

    return await callback(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
