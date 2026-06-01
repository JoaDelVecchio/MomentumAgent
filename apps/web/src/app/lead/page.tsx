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
      <header className="lead-nav">
        <a className="brand-mark" href="/">
          Momentum
        </a>
        <a className="back-link" href="/">
          Volver al sitio
        </a>
      </header>

      <section className="lead-hero" aria-label="Solicitud de piloto Momentum">
        <div className="lead-intro">
          <p className="eyebrow">Solicitud de piloto</p>
          <h1>Tu piloto empieza con contexto.</h1>
          <p>
            Contanos cómo tu clínica gestiona WhatsApp, agenda y seguimiento hoy. Revisamos encaje,
            reglas y calendario antes de activar pacientes reales.
          </p>
          <div className="lead-proof">
            <span>
              <MessageCircle aria-hidden="true" /> WhatsApp nativo
            </span>
            <span>
              <CalendarCheck aria-hidden="true" /> Agenda real
            </span>
            <span>
              <ShieldCheck aria-hidden="true" /> Activación asistida
            </span>
          </div>

          <div className="lead-preview" aria-label="Diagnóstico operativo Momentum">
            <div className="panel-head">
              <span>Diagnóstico operativo</span>
              <strong>piloto</strong>
            </div>
            <div className="preview-line">
              <span>1</span>
              <p>Entendemos volumen y dolor principal.</p>
            </div>
            <div className="preview-line">
              <span>2</span>
              <p>Revisamos agenda, reglas y derivaciones.</p>
            </div>
            <div className="preview-line">
              <span>3</span>
              <p>Definimos una activación controlada.</p>
            </div>
          </div>
        </div>

        <section className="lead-form-section" aria-label="Formulario de solicitud para clínicas">
          <form className="lead-form" onSubmit={handleSubmit}>
            <div className="form-heading">
              <Sparkles aria-hidden="true" />
              <div>
                <h2>Datos de la clínica</h2>
                <p>Campos mínimos para evaluar si Momentum puede operar bien desde el primer día.</p>
              </div>
            </div>

            <label>
              Nombre y apellido
              <input
                name="contactName"
                required
                value={form.contactName}
                onChange={(event) => setForm({ ...form, contactName: event.target.value })}
              />
            </label>

            <label>
              Nombre de la clínica
              <input
                name="clinicName"
                required
                value={form.clinicName}
                onChange={(event) => setForm({ ...form, clinicName: event.target.value })}
              />
            </label>

            <label>
              WhatsApp o teléfono
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
                Ciudad
                <input
                  name="city"
                  required
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />
              </label>
              <label>
                País
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
                Profesionales
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
                Consultas mensuales por WhatsApp
                <select
                  name="monthlyWhatsappInquiries"
                  required
                  value={form.monthlyWhatsappInquiries}
                  onChange={(event) =>
                    setForm({ ...form, monthlyWhatsappInquiries: event.target.value })
                  }
                >
                  <option value="">Seleccionar rango</option>
                  <option value="under-50">Menos de 50</option>
                  <option value="50-200">50-200</option>
                  <option value="200-500">200-500</option>
                  <option value="500-plus">500+</option>
                </select>
              </label>
            </div>

            <label>
              Sistema de agenda actual
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
              Principal dolor operativo
              <select
                name="mainPain"
                required
                value={form.mainPain}
                onChange={(event) =>
                  setForm({ ...form, mainPain: event.target.value as LeadMainPain })
                }
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
              {isSubmitting ? "Enviando..." : "Enviar solicitud"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
