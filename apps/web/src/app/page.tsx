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
    title: "El paciente escribe",
    body: "Momentum identifica intención, urgencia, tratamiento y contexto sin convertir la conversación en un formulario."
  },
  {
    icon: Sparkles,
    title: "Entiende y responde",
    body: "Contesta con información aprobada por la clínica: servicios, preparación, condiciones y próximos pasos."
  },
  {
    icon: CalendarCheck,
    title: "Ofrece agenda real",
    body: "Muestra horarios disponibles desde el calendario conectado y evita prometer turnos que no existen."
  },
  {
    icon: UserRoundCheck,
    title: "Confirma y sostiene",
    body: "Confirma, recuerda, reprograma y deriva a una persona cuando la conversación lo necesita."
  }
];

const automations = [
  "Reservas",
  "Reprogramaciones",
  "Cancelaciones",
  "Recordatorios",
  "Reactivación",
  "Huecos liberados",
  "Derivación humana"
];

const trustControls = [
  { icon: CalendarCheck, label: "Agenda real como fuente de verdad" },
  { icon: ShieldCheck, label: "Respuestas aprobadas y reglas de derivación" },
  { icon: Clock3, label: "Cobertura fuera de horario con trazabilidad" }
];

const problemCards = [
  {
    icon: Clock3,
    title: "La velocidad decide",
    body: "Quien responde claro primero suele quedarse con el turno."
  },
  {
    icon: MessageCircle,
    title: "WhatsApp no escala solo",
    body: "Preguntas, precios, horarios y cambios terminan mezclados en el mismo inbox."
  },
  {
    icon: Sparkles,
    title: "La demanda tibia se pierde",
    body: "Conversaciones viejas y huecos libres rara vez se reactivan a tiempo."
  }
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <section className="landing-hero section-band">
        <div className="hero-copy-block">
          <p className="eyebrow">Momentum para clínicas estéticas</p>
          <h1>La recepción IA que convierte WhatsApp en turnos confirmados.</h1>
          <p className="hero-copy">
            Momentum responde consultas, entiende intención, ofrece horarios reales y confirma
            turnos para clínicas estéticas que no quieren perder pacientes por demora.
          </p>
          <div className="hero-actions" aria-label="Acciones para piloto Momentum">
            <a className="primary-link" href="/lead">
              Activar piloto
            </a>
            <a className="secondary-link" href="#flow">
              Ver cómo funciona
            </a>
          </div>
          <div className="hero-proof" aria-label="Diferenciales Momentum">
            <span>WhatsApp nativo</span>
            <span>Agenda conectada</span>
            <span>Piloto asistido</span>
          </div>
        </div>

        <div className="operator-stage" aria-label="Conversación de WhatsApp convertida en turno">
          <div className="stage-orbit" aria-hidden="true" />
          <div className="signal-line primary" aria-hidden="true" />
          <div className="signal-line secondary" aria-hidden="true" />

          <div className="mock-phone">
            <div className="mock-phone-top">
              <span className="status-dot" />
              <span>Momentum en WhatsApp</span>
            </div>
            <div className="message-stack">
              <p className="message inbound">Hola, quiero consultar por botox esta semana.</p>
              <p className="message outbound">
                Puedo ayudarte. Para primera consulta tengo jueves 17:30 o viernes 10:00 con Dra.
                Mora.
              </p>
              <p className="message inbound">Jueves 17:30 me sirve.</p>
              <p className="message outbound strong">Turno confirmado. Te recuerdo 24 h antes.</p>
            </div>
          </div>

          <div className="intent-panel">
            <p className="panel-kicker">Intención detectada</p>
            <strong>Consulta estética</strong>
            <span>Urgencia: esta semana</span>
            <span>Servicio: botox</span>
            <span>Estado: lista para reservar</span>
          </div>

          <div className="booking-card">
            <div className="booking-card-head">
              <span>Agenda real</span>
              <strong>17:30</strong>
            </div>
            <div className="booking-row muted-row">
              <span>16:45</span>
              <span>Control facial</span>
            </div>
            <div className="booking-row active-row">
              <span>17:30</span>
              <span>Consulta botox</span>
            </div>
            <div className="booking-row">
              <span>18:15</span>
              <span>Hueco disponible</span>
            </div>
          </div>
        </div>
      </section>

      <section className="problem-section section-band">
        <div>
          <p className="eyebrow">La fuga invisible</p>
          <h2>El paciente no espera a que recepción tenga tiempo.</h2>
        </div>
        <div className="problem-grid">
          {problemCards.map((card) => {
            const Icon = card.icon;
            return (
              <article className="feature-card" key={card.title}>
                <Icon aria-hidden="true" />
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="flow" className="flow-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Flujo operativo</p>
          <h2>No es un bot genérico. Es un operador entrenado para convertir demanda real en agenda real.</h2>
          <p>
            Momentum acompaña el camino completo desde el primer mensaje hasta el turno confirmado,
            con reglas, agenda y derivación humana cuando corresponde.
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
          <p className="eyebrow">Superficie de automatización</p>
          <h2>Agenda real. Conversaciones reales. Turnos confirmados.</h2>
          <p>
            Un operador conectado cubre el trabajo repetido alrededor de los turnos mientras tu
            equipo mantiene control sobre servicios, políticas y excepciones.
          </p>
        </div>
        <div className="automation-list" aria-label="Automatizaciones de Momentum">
          {automations.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="trust-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Capa de control</p>
          <h2>Tu calendario sigue siendo la fuente de verdad.</h2>
          <p>
            Momentum reserva sólo contra la agenda conectada, respeta reglas de derivación y se
            activa con revisión asistida antes de operar en producción.
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
        <p className="eyebrow">Piloto asistido</p>
        <h2>Empezá con un piloto asistido.</h2>
        <p>
          Revisamos tu clínica, tu agenda y tus reglas antes de activar una experiencia controlada
          con pacientes reales.
        </p>
        <a className="primary-link" href="/lead">
          Solicitar revisión
        </a>
      </section>
    </main>
  );
}
