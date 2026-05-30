"use client";

import { FormEvent, useState } from "react";
import { CalendarCheck, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { submitClinicLead } from "../../lib/api";
import type { ClinicLeadPayload, LeadMainPain } from "../../lib/types";

const painOptions: Array<{ value: LeadMainPain; label: string }> = [
  { value: "missed_leads", label: "Leads que se enfrían sin respuesta" },
  { value: "reception_load", label: "Recepción saturada" },
  { value: "reactivation", label: "Reactivar conversaciones viejas" },
  { value: "no_shows", label: "Reducir ausencias" },
  { value: "rescheduling", label: "Reprogramaciones y cancelaciones" },
  { value: "other", label: "Otro" }
];

const initialForm: ClinicLeadPayload = {
  contactName: "",
  clinicName: "",
  whatsappOrPhone: "",
  city: "",
  country: "",
  professionalCount: 1,
  currentSchedulingSystem: "",
  monthlyWhatsappInquiries: "",
  mainPain: "missed_leads"
};

export default function LeadPage() {
  const [form, setForm] = useState<ClinicLeadPayload>(initialForm);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    try {
      await submitClinicLead(form);
      setStatus("success");
      setForm(initialForm);
    } catch {
      setStatus("error");
    }
  }

  const isSubmitting = status === "submitting";

  return (
    <main className="lead-shell">
      <section className="lead-intro">
        <a className="back-link" href="/">
          Momentum
        </a>
        <p className="eyebrow">Pilot application</p>
        <h1>Activate Momentum with an assisted clinic review.</h1>
        <p>
          Tell us how your clinic handles WhatsApp and appointments today. We will review fit before
          production activation.
        </p>
        <div className="lead-proof">
          <span>
            <MessageCircle aria-hidden="true" /> WhatsApp-native
          </span>
          <span>
            <CalendarCheck aria-hidden="true" /> Real agenda
          </span>
          <span>
            <ShieldCheck aria-hidden="true" /> Assisted launch
          </span>
        </div>
      </section>

      <section className="lead-form-section" aria-label="Clinic lead form">
        <form className="lead-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <Sparkles aria-hidden="true" />
            <div>
              <h2>Clinic details</h2>
              <p>Qualification fields for a controlled pilot.</p>
            </div>
          </div>

          <label>
            Contact name
            <input
              name="contactName"
              required
              value={form.contactName}
              onChange={(event) => setForm({ ...form, contactName: event.target.value })}
            />
          </label>

          <label>
            Clinic name
            <input
              name="clinicName"
              required
              value={form.clinicName}
              onChange={(event) => setForm({ ...form, clinicName: event.target.value })}
            />
          </label>

          <label>
            WhatsApp or phone
            <input
              name="whatsappOrPhone"
              required
              inputMode="tel"
              value={form.whatsappOrPhone}
              onChange={(event) => setForm({ ...form, whatsappOrPhone: event.target.value })}
            />
          </label>

          <div className="form-row">
            <label>
              City
              <input
                name="city"
                required
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </label>
            <label>
              Country
              <input
                name="country"
                required
                value={form.country}
                onChange={(event) => setForm({ ...form, country: event.target.value })}
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              Professionals
              <input
                name="professionalCount"
                required
                min={1}
                type="number"
                value={form.professionalCount}
                onChange={(event) =>
                  setForm({ ...form, professionalCount: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Monthly WhatsApp inquiries
              <select
                name="monthlyWhatsappInquiries"
                required
                value={form.monthlyWhatsappInquiries}
                onChange={(event) =>
                  setForm({ ...form, monthlyWhatsappInquiries: event.target.value })
                }
              >
                <option value="">Select range</option>
                <option value="under-50">Under 50</option>
                <option value="50-200">50-200</option>
                <option value="200-500">200-500</option>
                <option value="500-plus">500+</option>
              </select>
            </label>
          </div>

          <label>
            Current scheduling system
            <input
              name="currentSchedulingSystem"
              required
              placeholder="Google Calendar, Calendly, agenda manual..."
              value={form.currentSchedulingSystem}
              onChange={(event) =>
                setForm({ ...form, currentSchedulingSystem: event.target.value })
              }
            />
          </label>

          <label>
            Main pain
            <select
              name="mainPain"
              required
              value={form.mainPain}
              onChange={(event) => setForm({ ...form, mainPain: event.target.value as LeadMainPain })}
            >
              {painOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {status === "success" ? (
            <p className="form-status success">
              Listo. Vamos a revisar tu clínica y contactarte para activar un piloto asistido.
            </p>
          ) : null}
          {status === "error" ? (
            <p className="form-status error">
              No pudimos enviar la solicitud. Probá de nuevo o escribinos por WhatsApp.
            </p>
          ) : null}

          <button className="primary-link form-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Sending..." : "Send application"}
          </button>
        </form>
      </section>
    </main>
  );
}
