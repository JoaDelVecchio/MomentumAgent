import type { ClinicLeadPayload, ClinicLeadResponse } from "./types";

export const apiBaseUrl = "/api/backend";

export function adminHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { cache: "no-store", ...jsonRequestInit(init) });

  if (!response.ok) {
    let detail = "";
    try {
      detail = `: ${JSON.stringify(await response.json())}`;
    } catch {
      detail = "";
    }
    throw new Error(`API ${path} failed with ${response.status}${detail}`);
  }

  return (await response.json()) as T;
}

export async function submitClinicLead(payload: ClinicLeadPayload): Promise<ClinicLeadResponse> {
  const response = await fetch(`${apiBaseUrl}/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Lead submission failed with status ${response.status}`);
  }

  return response.json() as Promise<ClinicLeadResponse>;
}

function jsonRequestInit(init?: RequestInit): RequestInit | undefined {
  if (!init || init.body !== undefined) {
    return init;
  }

  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || !hasJsonContentType(init.headers)) {
    return init;
  }

  return { ...init, body: JSON.stringify({}) };
}

function hasJsonContentType(headers: HeadersInit | undefined): boolean {
  if (!headers) {
    return false;
  }

  if (headers instanceof Headers) {
    return headers.get("content-type")?.includes("application/json") ?? false;
  }

  if (Array.isArray(headers)) {
    return headers.some(([name, value]) => name.toLowerCase() === "content-type" && value.includes("application/json"));
  }

  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === "content-type" && String(value).includes("application/json")
  );
}
