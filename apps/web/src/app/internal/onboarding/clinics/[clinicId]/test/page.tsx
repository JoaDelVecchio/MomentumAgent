"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiJson, adminHeaders } from "../../../../../../lib/api";
import type { TestMessageResponse } from "../../../../../../lib/types";

const defaultMessage = "Hola, quiero reservar botox.";

export default function ClinicTestModePage() {
  const params = useParams<{ clinicId: string }>();
  const clinicId = params.clinicId;
  const [token, setToken] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [response, setResponse] = useState<TestMessageResponse | null>(null);
  const [status, setStatus] = useState("Enter an admin token and run a scoped test message.");
  const [isRunning, setIsRunning] = useState(false);

  async function runTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setStatus("Running test message...");
    setResponse(null);

    try {
      const result = await apiJson<TestMessageResponse>(`/internal/onboarding/clinics/${clinicId}/test-message`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({ text: message })
      });
      setResponse(result);
      setStatus(isPassingResult(result) ? "Test passed." : "Test completed without a booking-ready reply.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to run test message.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="internal-shell narrow">
      <header className="internal-header compact">
        <div>
          <Link className="back-link" href={`/internal/onboarding/clinics/${clinicId}`}>
            {clinicId}
          </Link>
          <p className="eyebrow">Test mode</p>
          <h1>Conversation test</h1>
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

      <form className="internal-panel internal-form" onSubmit={runTest}>
        <div className="internal-panel-heading">
          <h2>Run test</h2>
        </div>
        <label>
          Message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} />
        </label>
        <button className="primary-link form-submit" disabled={isRunning || !token || !message.trim()} type="submit">
          {isRunning ? "Running..." : "Run test"}
        </button>
        <p className={isPassingResult(response) ? "form-status success" : "internal-status"} role="status">
          {status}
        </p>
      </form>

      <section className="internal-panel response-panel">
        <div className="internal-panel-heading">
          <h2>Response panel</h2>
        </div>
        {response ? <pre>{JSON.stringify(response.result, null, 2)}</pre> : <p className="internal-empty">No response yet.</p>}
      </section>
    </main>
  );
}

function isPassingResult(response: TestMessageResponse | null): boolean {
  return response?.result.kind === "reply" && Boolean(response.result.text);
}
