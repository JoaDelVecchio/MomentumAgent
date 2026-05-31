"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { profileChecklistState, type ChecklistState } from "../../../../../../lib/activation-readiness";
import { apiBaseUrl, apiJson, adminHeaders } from "../../../../../../lib/api";
import type {
  ActivationErrorResponse,
  ClinicReadinessKey,
  ClinicSetupRecord,
  ClinicSetupResponse
} from "../../../../../../lib/types";

const setupReadinessItems: Array<{ key: ClinicReadinessKey; label: string; getValue: (setup: ClinicSetupRecord) => boolean }> = [
  { key: "payment", label: "Payment eligible", getValue: (setup) => ["paid", "trial", "waived"].includes(setup.paymentStatus) },
  { key: "whatsapp", label: "WhatsApp ready", getValue: (setup) => setup.whatsappReady },
  { key: "calendar", label: "Calendar connected", getValue: (setup) => setup.calendarConnected },
  { key: "test_conversation", label: "Test conversation passed", getValue: (setup) => setup.testConversationPassed },
  {
    key: "activation_checklist",
    label: "Activation checklist completed",
    getValue: (setup) => setup.activationChecklistCompleted
  }
];

export default function ClinicActivationPage() {
  const params = useParams<{ clinicId: string }>();
  const clinicId = params.clinicId;
  const [token, setToken] = useState("");
  const [setup, setSetup] = useState<ClinicSetupRecord | null>(null);
  const [missing, setMissing] = useState<ClinicReadinessKey[]>([]);
  const [activationAttempted, setActivationAttempted] = useState(false);
  const [activationSucceeded, setActivationSucceeded] = useState(false);
  const [status, setStatus] = useState("Enter an admin token, then load activation state.");
  const [isBusy, setIsBusy] = useState(false);
  const profileState = profileChecklistState({ activationAttempted, activationSucceeded, missing });

  async function loadClinic() {
    setIsBusy(true);
    setStatus("Loading activation state...");

    try {
      const response = await apiJson<ClinicSetupResponse>(`/internal/onboarding/clinics/${clinicId}`, {
        headers: adminHeaders(token)
      });
      setSetup(response.setup);
      setMissing([]);
      setActivationAttempted(false);
      setActivationSucceeded(false);
      setStatus("Activation state loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load activation state.");
    } finally {
      setIsBusy(false);
    }
  }

  async function activateClinic() {
    setIsBusy(true);
    setStatus("Activating clinic...");

    try {
      const response = await postLifecycle(`/internal/onboarding/clinics/${clinicId}/activate`, token);
      setSetup(response.setup);
      setMissing([]);
      setActivationAttempted(true);
      setActivationSucceeded(true);
      setStatus("Clinic activated.");
    } catch (error) {
      if (isActivationError(error)) {
        setMissing(error.missing ?? []);
        setActivationAttempted(true);
        setActivationSucceeded(false);
        setStatus(error.error === "clinic_not_ready" ? "Clinic is missing readiness requirements." : error.error);
      } else {
        setStatus(error instanceof Error ? error.message : "Unable to activate clinic.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function pauseClinic() {
    setIsBusy(true);
    setStatus("Pausing clinic...");

    try {
      const response = await apiJson<ClinicSetupResponse>(`/internal/onboarding/clinics/${clinicId}/pause`, {
        method: "POST",
        headers: adminHeaders(token)
      });
      setSetup(response.setup);
      setStatus("Clinic paused.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to pause clinic.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="internal-shell narrow">
      <header className="internal-header compact">
        <div>
          <Link className="back-link" href={`/internal/onboarding/clinics/${clinicId}`}>
            {clinicId}
          </Link>
          <p className="eyebrow">Activation</p>
          <h1>Production gate</h1>
        </div>
        <label className="internal-token">
          Admin token
          <input
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Bearer token value"
            type="password"
          />
        </label>
      </header>

      <section className="internal-toolbar">
        <button className="primary-link" disabled={isBusy || !token} onClick={loadClinic} type="button">
          {isBusy ? "Working..." : "Load activation state"}
        </button>
        <button className="primary-link" disabled={isBusy || !token || !setup} onClick={activateClinic} type="button">
          Activate
        </button>
        <button className="secondary-link button-like" disabled={isBusy || !token || !setup} onClick={pauseClinic} type="button">
          Pause
        </button>
        <p className="internal-status" role="status">
          {status}
        </p>
      </section>

      <section className="internal-panel">
        <div className="internal-panel-heading">
          <h2>Readiness checklist</h2>
          {setup ? <span>{setup.lifecycleState}</span> : null}
        </div>
        {setup ? (
          <div className="check-stack">
            <div className="check-row readonly">
              <span className={indicatorClass(profileState)} />
              <span>Clinic profile saved</span>
              {profileState === "unknown" ? <span className="check-note">Check on activation</span> : null}
            </div>
            {setupReadinessItems.map((item) => (
              <div className="check-row readonly" key={item.key}>
                <span className={indicatorClass(item.getValue(setup))} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="internal-empty">Load the clinic to inspect readiness.</p>
        )}
      </section>

      <section className="internal-grid two">
        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Payment state</h2>
          </div>
          <p className="metric-value">{setup?.paymentStatus ?? "not loaded"}</p>
        </div>
        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Missing readiness keys</h2>
          </div>
          {missing.length > 0 ? (
            <ul className="missing-list">
              {missing.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          ) : (
            <p className="internal-empty">No backend missing keys returned yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}

async function postLifecycle(path: string, token: string): Promise<ClinicSetupResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: adminHeaders(token),
    body: JSON.stringify({})
  });
  const body = (await response.json()) as ClinicSetupResponse | ActivationErrorResponse;

  if (!response.ok) {
    throw body;
  }

  return body as ClinicSetupResponse;
}

function isActivationError(error: unknown): error is ActivationErrorResponse {
  return Boolean(error && typeof error === "object" && "error" in error);
}

function indicatorClass(state: ChecklistState): string {
  if (state === true) {
    return "check-indicator on";
  }
  if (state === "unknown") {
    return "check-indicator unknown";
  }
  return "check-indicator";
}
