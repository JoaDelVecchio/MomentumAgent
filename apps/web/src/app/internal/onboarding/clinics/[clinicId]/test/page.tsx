"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiJson, adminHeaders } from "../../../../../../lib/api";
import { createTestModeSession, type TestModeSession } from "../../../../../../lib/test-mode-session";
import { isPassingTestModeResult } from "../../../../../../lib/test-mode-readiness";
import type { TestMessageResponse } from "../../../../../../lib/types";

const defaultMessage = "Hola, quiero reservar botox.";

type ChatMessage = {
  id: string;
  role: "patient" | "momentum";
  text: string;
};

export default function ClinicTestModePage() {
  const params = useParams<{ clinicId: string }>();
  const clinicId = params.clinicId;
  const [token, setToken] = useState("");
  const [session, setSession] = useState<TestModeSession>(() => createTestModeSession(clinicId));
  const [message, setMessage] = useState(defaultMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [response, setResponse] = useState<TestMessageResponse | null>(null);
  const [status, setStatus] = useState("Enter an admin token and send a test message.");
  const [isRunning, setIsRunning] = useState(false);
  const [threadPaused, setThreadPaused] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || threadPaused) {
      return;
    }

    const patientMessage: ChatMessage = { id: `${Date.now()}:patient`, role: "patient", text };
    setMessages((current) => [...current, patientMessage]);
    setMessage("");
    setIsRunning(true);
    setStatus("Sending test message...");

    try {
      const result = await apiJson<TestMessageResponse>(`/internal/onboarding/clinics/${clinicId}/test-message`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({
          text,
          conversationId: session.conversationId,
          patientId: session.patientId,
          whatsappNumber: session.whatsappNumber
        })
      });
      setResponse(result);
      setMessages((current) => [
        ...current,
        { id: `${Date.now()}:momentum`, role: "momentum", text: result.result.text ?? result.result.kind }
      ]);
      setThreadPaused(result.result.kind === "handoff");
      setStatus(isPassingResult(result) ? "Test passed." : "Message processed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to run test message.");
    } finally {
      setIsRunning(false);
    }
  }

  function startNewConversation() {
    setSession(createTestModeSession(clinicId));
    setMessages([]);
    setResponse(null);
    setThreadPaused(false);
    setMessage(defaultMessage);
    setStatus("New test conversation ready.");
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

      <section className="internal-panel test-chat-shell">
        <div className="internal-panel-heading">
          <h2>Chat console</h2>
          <button className="secondary-link button-like" onClick={startNewConversation} type="button">
            New conversation
          </button>
        </div>
        <p className="test-chat-meta">Test mode uses live availability and keeps the calendar unchanged.</p>
        <div className="test-chat-thread" aria-live="polite">
          {messages.length > 0 ? (
            messages.map((chatMessage) => (
              <article className={`test-chat-message ${chatMessage.role}`} key={chatMessage.id}>
                <span className="test-chat-role">{chatMessage.role === "patient" ? "Patient" : "Momentum"}</span>
                {chatMessage.text}
              </article>
            ))
          ) : (
            <p className="internal-empty">No messages yet.</p>
          )}
        </div>
        <form className="test-chat-composer internal-form" onSubmit={sendMessage}>
          <label>
            Message
            <textarea
              disabled={threadPaused}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
            />
          </label>
          <div className="test-chat-actions">
            <button
              className="primary-link form-submit"
              disabled={isRunning || !token || !message.trim() || threadPaused}
              type="submit"
            >
              {isRunning ? "Sending..." : "Send message"}
            </button>
          </div>
        </form>
        <p className={isPassingResult(response) ? "form-status success" : "internal-status"} role="status">
          {threadPaused ? "Thread paused after handoff. Start a new conversation to continue." : status}
        </p>
      </section>

      <section className="internal-panel response-panel">
        <div className="internal-panel-heading">
          <h2>Response panel</h2>
        </div>
        {response ? <pre>{JSON.stringify(response.result, null, 2)}</pre> : <p className="internal-empty">No response yet.</p>}
      </section>
    </main>
  );
}

const isPassingResult = isPassingTestModeResult;
