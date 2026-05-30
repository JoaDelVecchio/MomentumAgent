import {
  CalendarCheck,
  Clock3,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRoundCheck
} from "lucide-react";

const flowSteps = [
  {
    icon: MessageCircle,
    title: "Lead writes on WhatsApp",
    body: "Momentum understands intent, service interest, urgency, and the clinic context."
  },
  {
    icon: Sparkles,
    title: "Answers like your front desk",
    body: "It explains approved services, preparation, pricing notes, and next available actions."
  },
  {
    icon: CalendarCheck,
    title: "Books against real availability",
    body: "Agenda real. Conversations reales. Turnos confirmados."
  },
  {
    icon: UserRoundCheck,
    title: "Keeps the patient moving",
    body: "Reschedules, cancels, reminds, follows up, and hands off when a human should step in."
  }
];

const automations = [
  "Bookings",
  "Reschedules",
  "Cancellations",
  "Reminders",
  "Warm-lead reactivation",
  "Freed-slot offers",
  "Human handoff"
];

const trustControls = [
  { icon: CalendarCheck, label: "Live availability only" },
  { icon: ShieldCheck, label: "Approved answers and handoff rules" },
  { icon: Clock3, label: "After-hours coverage with auditability" }
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <section className="landing-hero section-band">
        <div className="hero-copy-block">
          <p className="eyebrow">Momentum AI Receptionist</p>
          <h1>Turn WhatsApp into your clinic&apos;s appointment engine.</h1>
          <p className="hero-copy">
            Momentum is the AI receptionist for aesthetic and dermatology clinics. It replies,
            qualifies demand, offers real calendar slots, confirms visits, and brings warm patients
            back without making your team chase every conversation.
          </p>
          <div className="hero-actions" aria-label="Momentum pilot actions">
            <a className="primary-link" href="/lead">
              Activate a pilot
            </a>
            <a className="secondary-link" href="#flow">
              See the flow
            </a>
          </div>
        </div>

        <div className="product-mockup" aria-label="WhatsApp conversation connected to calendar">
          <div className="mock-phone">
            <div className="mock-phone-top">
              <span className="status-dot" />
              <span>Momentum on WhatsApp</span>
            </div>
            <div className="message-stack">
              <p className="message inbound">Hola, quiero consultar por Botox para esta semana.</p>
              <p className="message outbound">
                Tengo disponibilidad real con Dra. Mora el jueves 17:30 o viernes 10:00.
              </p>
              <p className="message inbound">Jueves 17:30 me sirve.</p>
              <p className="message outbound strong">Turno confirmado. Te mando recordatorio 24h antes.</p>
            </div>
          </div>
          <div className="mock-calendar">
            <div className="calendar-head">
              <span>Clinic agenda</span>
              <strong>17:30</strong>
            </div>
            <div className="calendar-row muted-row">
              <span>16:45</span>
              <span>Control facial</span>
            </div>
            <div className="calendar-row active-row">
              <span>17:30</span>
              <span>Botox consultation</span>
            </div>
            <div className="calendar-row">
              <span>18:15</span>
              <span>Available slot</span>
            </div>
          </div>
        </div>
      </section>

      <section className="problem-section section-band">
        <div>
          <p className="eyebrow">The leak</p>
          <h2>Every unanswered WhatsApp is demand cooling down.</h2>
        </div>
        <div className="problem-grid">
          <article className="feature-card">
            <Clock3 aria-hidden="true" />
            <h3>Speed decides intent</h3>
            <p>Patients message several clinics, compare replies, and book where the path is clear.</p>
          </article>
          <article className="feature-card">
            <MessageCircle aria-hidden="true" />
            <h3>Chats become manual work</h3>
            <p>Reception jumps between questions, pricing, availability, reminders, and follow-ups.</p>
          </article>
          <article className="feature-card">
            <Sparkles aria-hidden="true" />
            <h3>Warm demand gets forgotten</h3>
            <p>Old conversations and freed slots can produce visits, but they rarely get chased.</p>
          </article>
        </div>
      </section>

      <section id="flow" className="flow-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Operator flow</p>
          <h2>Not a chatbot. A booking operator for aesthetic clinics.</h2>
          <p>
            Momentum is built around the operational path from first WhatsApp message to confirmed
            appointment, not around generic automation scripts.
          </p>
        </div>
        <div className="flow-grid">
          {flowSteps.map((step) => {
            const Icon = step.icon;
            return (
              <article className="flow-step" key={step.title}>
                <Icon aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="automation-section section-band">
        <div className="automation-panel">
          <p className="eyebrow">Automation surface</p>
          <h2>Agenda real. Conversations reales. Turnos confirmados.</h2>
          <p>
            One connected operator covers the repeated work around appointments while your team
            keeps control over services, policies, exceptions, and launch readiness.
          </p>
        </div>
        <div className="automation-list" aria-label="Momentum automation capabilities">
          {automations.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="trust-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Control layer</p>
          <h2>Your calendar stays the source of truth.</h2>
          <p>
            Momentum books only against the clinic agenda, respects handoff rules, and launches with
            assisted activation instead of unmanaged self-serve automation.
          </p>
        </div>
        <div className="trust-grid">
          {trustControls.map((control) => {
            const Icon = control.icon;
            return (
              <article className="control-card" key={control.label}>
                <Icon aria-hidden="true" />
                <span>{control.label}</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="final-cta section-band">
        <p className="eyebrow">Assisted pilot</p>
        <h2>Start with a reviewed clinic setup, then activate with confidence.</h2>
        <p>
          Share your clinic details and we will evaluate fit, setup needs, and the fastest route to a
          controlled Momentum pilot.
        </p>
        <a className="primary-link" href="/lead">
          Apply for a pilot
        </a>
      </section>
    </main>
  );
}
