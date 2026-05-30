import type { ClinicLeadPayload, ClinicLeadResponse } from "./types";

export const apiBaseUrl = "/api/backend";

export function adminHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { cache: "no-store", ...init });

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
