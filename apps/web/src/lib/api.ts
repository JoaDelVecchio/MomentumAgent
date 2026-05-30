import type { ClinicLeadPayload, ClinicLeadResponse } from "./types";

export const apiBaseUrl = "/api/backend";

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
