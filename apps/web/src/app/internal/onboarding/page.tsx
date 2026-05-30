"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiJson, adminHeaders } from "../../../lib/api";
import type {
  ClinicLeadRecord,
  ClinicSetupRecord,
  ClinicsResponse,
  LeadsResponse,
  ManualClinicPayload,
  ClinicSetupResponse
} from "../../../lib/types";

const initialClinic: ManualClinicPayload = {
  clinicId: "",
  clinicName: "",
  primaryContactName: "",
  primaryContactPhone: "",
  city: "",
  country: "",
  source: "presencial"
};

export default function InternalOnboardingPage() {
  const [token, setToken] = useState("");
  const [leads, setLeads] = useState<ClinicLeadRecord[]>([]);
  const [clinics, setClinics] = useState<ClinicSetupRecord[]>([]);
  const [manualClinic, setManualClinic] = useState<ManualClinicPayload>(initialClinic);
  const [status, setStatus] = useState("Enter an admin token, then load onboarding data.");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  async function loadOnboardingData() {
    setIsLoading(true);
    setStatus("Loading onboarding data...");

    try {
      const headers = adminHeaders(token);
      const [leadResponse, clinicResponse] = await Promise.all([
        apiJson<LeadsResponse>("/internal/onboarding/leads", { headers }),
        apiJson<ClinicsResponse>("/internal/onboarding/clinics", { headers })
      ]);
      setLeads(leadResponse.leads);
      setClinics(clinicResponse.clinics);
      setStatus("Onboarding data loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load onboarding data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createManualClinic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setStatus("Creating clinic setup...");

    try {
      const response = await apiJson<ClinicSetupResponse>("/internal/onboarding/clinics", {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify(manualClinic)
      });
      setClinics((current) => [response.setup, ...current.filter((clinic) => clinic.clinicId !== response.setup.clinicId)]);
      setManualClinic(initialClinic);
      setStatus(`Created clinic setup ${response.setup.clinicId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create clinic setup.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="internal-shell">
      <header className="internal-header">
        <div>
          <p className="eyebrow">Internal operations</p>
          <h1>Momentum Clinic Onboarding</h1>
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

      <section className="internal-toolbar" aria-label="Onboarding actions">
        <button className="primary-link" disabled={isLoading || !token} onClick={loadOnboardingData} type="button">
          {isLoading ? "Loading..." : "Load leads and clinics"}
        </button>
        <p className="internal-status" role="status">
          {status}
        </p>
      </section>

      <section className="internal-grid">
        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Leads</h2>
            <span>{leads.length}</span>
          </div>
          <div className="internal-list">
            {leads.length === 0 ? <p className="internal-empty">No leads loaded.</p> : null}
            {leads.map((lead) => (
              <article className="internal-list-item" key={lead.id}>
                <div>
                  <h3>{lead.clinicName}</h3>
                  <p>
                    {lead.contactName} - {lead.city}, {lead.country}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{lead.status}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{lead.source}</dd>
                  </div>
                  <div>
                    <dt>WhatsApp</dt>
                    <dd>{lead.whatsappOrPhone}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>

        <div className="internal-panel">
          <div className="internal-panel-heading">
            <h2>Clinics</h2>
            <span>{clinics.length}</span>
          </div>
          <div className="internal-list">
            {clinics.length === 0 ? <p className="internal-empty">No clinic setups loaded.</p> : null}
            {clinics.map((clinic) => (
              <article className="internal-list-item" key={clinic.clinicId}>
                <div>
                  <h3>{clinic.clinicId}</h3>
                  <p>
                    {clinic.primaryContactName} - {clinic.city}, {clinic.country}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Lifecycle</dt>
                    <dd>{clinic.lifecycleState}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{clinic.paymentStatus}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(clinic.updatedAt)}</dd>
                  </div>
                </dl>
                <Link className="secondary-link internal-link" href={`/internal/onboarding/clinics/${clinic.clinicId}`}>
                  Open setup
                </Link>
              </article>
            ))}
          </div>
        </div>

        <form className="internal-panel internal-form" onSubmit={createManualClinic}>
          <div className="internal-panel-heading">
            <h2>Create clinic manually</h2>
          </div>
          <div className="form-row">
            <label>
              Clinic ID
              <input
                required
                value={manualClinic.clinicId}
                onChange={(event) => setManualClinic({ ...manualClinic, clinicId: event.target.value })}
                placeholder="clinic_derma_norte"
              />
            </label>
            <label>
              Clinic name
              <input
                required
                value={manualClinic.clinicName}
                onChange={(event) => setManualClinic({ ...manualClinic, clinicName: event.target.value })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Contact name
              <input
                required
                value={manualClinic.primaryContactName}
                onChange={(event) => setManualClinic({ ...manualClinic, primaryContactName: event.target.value })}
              />
            </label>
            <label>
              Contact phone
              <input
                required
                value={manualClinic.primaryContactPhone}
                onChange={(event) => setManualClinic({ ...manualClinic, primaryContactPhone: event.target.value })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              City
              <input
                required
                value={manualClinic.city}
                onChange={(event) => setManualClinic({ ...manualClinic, city: event.target.value })}
              />
            </label>
            <label>
              Country
              <input
                required
                value={manualClinic.country}
                onChange={(event) => setManualClinic({ ...manualClinic, country: event.target.value })}
              />
            </label>
          </div>
          <label>
            Source
            <select
              value={manualClinic.source}
              onChange={(event) =>
                setManualClinic({ ...manualClinic, source: event.target.value as ManualClinicPayload["source"] })
              }
            >
              <option value="presencial">presencial</option>
              <option value="referido">referido</option>
              <option value="outbound">outbound</option>
              <option value="landing">landing</option>
            </select>
          </label>
          <button className="primary-link form-submit" disabled={isCreating || !token} type="submit">
            {isCreating ? "Creating..." : "Create clinic"}
          </button>
        </form>
      </section>
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
