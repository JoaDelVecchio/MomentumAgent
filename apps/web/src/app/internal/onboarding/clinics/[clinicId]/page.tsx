"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiJson, adminHeaders } from "../../../../../lib/api";
import { calendarMappingWarnings } from "../../../../../lib/google-calendar-onboarding-ui";
import type {
  ClinicPaymentStatus,
  ClinicSetupRecord,
  ClinicSetupResponse,
  GoogleCalendarConnectionStatus,
  GoogleCalendarListResponse,
  GoogleCalendarStartResponse,
  GoogleCalendarStatusResponse,
  GoogleCalendarSummary
} from "../../../../../lib/types";

const readinessLabels: Array<{ key: keyof Pick<
  ClinicSetupRecord,
  "whatsappReady" | "testConversationPassed" | "activationChecklistCompleted"
>; label: string }> = [
  { key: "whatsappReady", label: "WhatsApp ready" },
  { key: "testConversationPassed", label: "Test conversation passed" },
  { key: "activationChecklistCompleted", label: "Activation checklist completed" }
];

type EditableClinicProfile = {
  professionals?: Array<{ id: string; name: string; calendarId?: string }>;
  services?: Array<{ id: string; name: string; professionalIds: string[] }>;
};

const initialClinicProfileJson = JSON.stringify(
  {
    name: "Clinica Demo",
    timezone: "America/Argentina/Buenos_Aires",
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        durationMinutes: 30,
        priceText: "Desde $120.000",
        preparation: "Evitar alcohol 24 horas antes.",
        restrictions: [],
        professionalIds: ["pro_perez"]
      }
    ],
    professionals: [
      {
        id: "pro_perez",
        name: "Dra. Perez",
        calendarId: "cal_perez",
        workingHours: [{ day: 1, startTime: "09:00", endTime: "17:00" }]
      }
    ],
    appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 1440, bufferMinutes: 0 },
    requiredPatientFields: ["fullName"]
  },
  null,
  2
);

export default function ClinicSetupPage() {
  const params = useParams<{ clinicId: string }>();
  const clinicId = params.clinicId;
  const [token, setToken] = useState("");
  const [setup, setSetup] = useState<ClinicSetupRecord | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarConnectionStatus | null>(null);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [status, setStatus] = useState("Enter an admin token, then load this clinic setup.");
  const [isBusy, setIsBusy] = useState(false);
  const [localKnowledge, setLocalKnowledge] = useState(
    "Payment methods:\nInsurance:\nAddress and parking:\nCancellation policy:"
  );
  const [profileJson, setProfileJson] = useState(initialClinicProfileJson);

  async function loadClinic() {
    setIsBusy(true);
    setStatus("Loading clinic setup...");

    try {
      const response = await apiJson<ClinicSetupResponse>(`/internal/onboarding/clinics/${clinicId}`, {
        headers: adminHeaders(token)
      });
      setSetup(response.setup);
      try {
        await loadGoogleCalendarStatus();
      } catch {
        setGoogleStatus(null);
      }
      setStatus("Clinic setup loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load clinic setup.");
    } finally {
      setIsBusy(false);
    }
  }

  async function updatePayment(paymentStatus: ClinicPaymentStatus) {
    setIsBusy(true);
    setStatus("Updating payment status...");

    try {
      const response = await apiJson<ClinicSetupResponse>(`/internal/onboarding/clinics/${clinicId}/payment`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify({ paymentStatus })
      });
      setSetup(response.setup);
      setStatus("Payment status updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update payment status.");
    } finally {
      setIsBusy(false);
    }
  }

  async function updateReadiness(key: keyof ClinicSetupRecord, checked: boolean) {
    setIsBusy(true);
    setStatus("Updating readiness...");

    try {
      const response = await apiJson<ClinicSetupResponse>(`/internal/onboarding/clinics/${clinicId}/readiness`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify({ [key]: checked })
      });
      setSetup(response.setup);
      setStatus("Readiness updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update readiness.");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadGoogleCalendarStatus() {
    const response = await apiJson<GoogleCalendarStatusResponse>(
      `/internal/onboarding/clinics/${clinicId}/google-calendar/status`,
      { headers: adminHeaders(token) }
    );
    setGoogleStatus(response.status);
  }

  async function connectGoogleCalendar() {
    setIsBusy(true);
    setStatus("Starting Google Calendar connection...");
    try {
      const response = await apiJson<GoogleCalendarStartResponse>(
        `/internal/onboarding/clinics/${clinicId}/google-calendar/start`,
        { method: "POST", headers: adminHeaders(token) }
      );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to start Google Calendar connection.");
      setIsBusy(false);
    }
  }

  async function loadGoogleCalendars() {
    setIsBusy(true);
    setStatus("Loading Google calendars...");
    try {
      const response = await apiJson<GoogleCalendarListResponse>(
        `/internal/onboarding/clinics/${clinicId}/google-calendar/calendars`,
        { headers: adminHeaders(token) }
      );
      setGoogleCalendars(response.calendars);
      setStatus("Google calendars loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load Google calendars.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveProfile() {
    let payload: unknown;
    try {
      payload = JSON.parse(profileJson);
    } catch {
      setStatus("Clinic profile JSON is invalid.");
      return;
    }

    setIsBusy(true);
    setStatus("Saving clinic profile...");

    try {
      const response = await apiJson<{ profile: { clinicId: string; name: string } }>(
        `/internal/onboarding/clinics/${clinicId}/profile`,
        {
          method: "PUT",
          headers: adminHeaders(token),
          body: JSON.stringify(payload)
        }
      );
      setStatus(`Clinic profile saved for ${response.profile.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save clinic profile.");
    } finally {
      setIsBusy(false);
    }
  }

  const parsedProfile = parseEditableProfile(profileJson);
  const mappingWarnings = calendarMappingWarnings({
    calendars: googleCalendars,
    professionals: parsedProfile?.professionals ?? [],
    services: parsedProfile?.services ?? []
  });
  const mappedCalendarIds = new Set(
    (parsedProfile?.professionals ?? [])
      .map((professional) => professional.calendarId ?? "")
      .filter(Boolean)
  );

  return (
    <main className="internal-shell">
      <header className="internal-header compact">
        <div>
          <Link className="back-link" href="/internal/onboarding">
            Momentum Clinic Onboarding
          </Link>
          <p className="eyebrow">Clinic setup</p>
          <h1>{clinicId}</h1>
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
          {isBusy ? "Working..." : "Load clinic setup"}
        </button>
        <Link className="secondary-link" href={`/internal/onboarding/clinics/${clinicId}/test`}>
          Test mode
        </Link>
        <Link className="secondary-link" href={`/internal/onboarding/clinics/${clinicId}/activation`}>
          Activation
        </Link>
        <p className="internal-status" role="status">
          {status}
        </p>
      </section>

      <section className="internal-grid two">
        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Status summary</h2>
          </div>
          {setup ? (
            <dl className="internal-summary">
              <div>
                <dt>Lifecycle</dt>
                <dd>{setup.lifecycleState}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{setup.paymentStatus}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{setup.primaryContactName}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{setup.primaryContactPhone}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{setup.city}, {setup.country}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDate(setup.updatedAt)}</dd>
              </div>
            </dl>
          ) : (
            <p className="internal-empty">Load the clinic to view current setup state.</p>
          )}
        </div>

        <div className="internal-panel internal-form">
          <div className="internal-panel-heading">
            <h2>Payment status</h2>
          </div>
          <label>
            Status
            <select
              disabled={!setup || isBusy}
              value={setup?.paymentStatus ?? "unpaid"}
              onChange={(event) => updatePayment(event.target.value as ClinicPaymentStatus)}
            >
              <option value="unpaid">unpaid</option>
              <option value="paid">paid</option>
              <option value="trial">trial</option>
              <option value="waived">waived</option>
            </select>
          </label>
        </div>

        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Readiness flags</h2>
          </div>
          <div className="check-stack">
            {readinessLabels.map((item) => (
              <label className="check-row" key={item.key}>
                <input
                  checked={Boolean(setup?.[item.key])}
                  disabled={!setup || isBusy}
                  onChange={(event) => updateReadiness(item.key, event.target.checked)}
                  type="checkbox"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="internal-panel internal-form">
          <div className="internal-panel-heading">
            <h2>Google Calendar</h2>
            {googleStatus ? <span>{googleStatus.connected ? "connected" : "not connected"}</span> : null}
          </div>
          <div className="internal-actions">
            <button className="primary-link" disabled={isBusy || !token} onClick={connectGoogleCalendar} type="button">
              {googleStatus?.connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </button>
            <button
              className="secondary-link button-like"
              disabled={isBusy || !token || !googleStatus?.connected || googleStatus.reconnectRequired}
              onClick={loadGoogleCalendars}
              type="button"
            >
              Refresh calendars
            </button>
          </div>
          {googleStatus && !googleStatus.connected ? (
            <p className="internal-empty">Connect Google Calendar to discover calendars and map each professional.</p>
          ) : null}
          {googleStatus?.connected && googleStatus.reconnectRequired ? (
            <p className="internal-empty">Reconnect Google Calendar to grant the required calendar-list permission.</p>
          ) : null}
          {mappingWarnings.unmappedServiceNames.length > 0 ? (
            <p className="internal-empty">
              Services with professionals missing a writable calendar: {mappingWarnings.unmappedServiceNames.join(", ")}.
            </p>
          ) : null}
          {mappingWarnings.nonBookableCalendarNames.length > 0 ? (
            <p className="internal-empty">
              Only owner/writer calendars can be selected. Non-bookable calendars:{" "}
              {mappingWarnings.nonBookableCalendarNames.join(", ")}.
            </p>
          ) : null}
          {mappingWarnings.duplicateCalendarIds.length > 0 ? (
            <p className="internal-empty">
              Duplicate calendar mappings in profile JSON: {mappingWarnings.duplicateCalendarIds.join(", ")}.
            </p>
          ) : null}
          <div className="calendar-map">
            {(parsedProfile?.professionals ?? []).map((professional) => (
              <label key={professional.id}>
                {professional.name}
                <select
                  value={professional.calendarId ?? ""}
                  onChange={(event) =>
                    setProfileJson(updateProfessionalCalendarId(profileJson, professional.id, event.target.value))
                  }
                >
                  <option value="">Select calendar</option>
                  {professional.calendarId && !googleCalendars.some((calendar) => calendar.id === professional.calendarId) ? (
                    <option value={professional.calendarId}>Current mapping: {professional.calendarId}</option>
                  ) : null}
                  {googleCalendars.map((calendar) => (
                    <option
                      disabled={
                        !calendar.bookable || (calendar.id !== professional.calendarId && mappedCalendarIds.has(calendar.id))
                      }
                      key={calendar.id}
                      value={calendar.id}
                    >
                      {calendar.summary} - {calendar.accessRole}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="internal-panel internal-form">
          <div className="internal-panel-heading">
            <h2>Clinic profile JSON</h2>
          </div>
          <label>
            Profile
            <textarea
              spellCheck={false}
              value={profileJson}
              onChange={(event) => setProfileJson(event.target.value)}
              rows={18}
            />
          </label>
          <button className="primary-link" disabled={isBusy || !token} onClick={saveProfile} type="button">
            {isBusy ? "Working..." : "Save clinic profile"}
          </button>
        </div>

        <div className="internal-panel internal-form">
          <div className="internal-panel-heading">
            <h2>Knowledge / FAQ deferred</h2>
          </div>
          <label>
            Local notes
            <textarea
              value={localKnowledge}
              onChange={(event) => setLocalKnowledge(event.target.value)}
              rows={8}
            />
          </label>
          <p className="internal-empty">
            Deferred for this branch: these notes are local only, are not saved, and are not used by the agent.
          </p>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function parseEditableProfile(value: string): EditableClinicProfile | undefined {
  try {
    const parsed = JSON.parse(value) as EditableClinicProfile;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function updateProfessionalCalendarId(profileJson: string, professionalId: string, calendarId: string): string {
  const parsed = JSON.parse(profileJson) as EditableClinicProfile;
  return JSON.stringify(
    {
      ...parsed,
      professionals: (parsed.professionals ?? []).map((professional) =>
        professional.id === professionalId ? { ...professional, calendarId } : professional
      )
    },
    null,
    2
  );
}
