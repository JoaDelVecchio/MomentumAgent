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
    label: "01",
    title: "Entra demanda",
    body: "WhatsApp deja de ser una bandeja caótica: cada mensaje llega con intención, urgencia y contexto."
  },
  {
    icon: Sparkles,
    label: "02",
    title: "Momentum decide el próximo paso",
    body: "Responde con reglas aprobadas, pide lo justo y separa consultas tibias de pacientes listos para reservar."
  },
  {
    icon: CalendarCheck,
    label: "03",
    title: "Reserva sobre agenda real",
    body: "Ofrece horarios disponibles desde el calendario conectado. No inventa turnos, no pisa disponibilidad."
  },
  {
    icon: UserRoundCheck,
    label: "04",
    title: "Cierra o deriva",
    body: "Confirma, recuerda y deriva a recepción cuando aparece una excepción comercial o clínica."
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

const controlPoints = [
  {
    icon: CalendarCheck,
    title: "Agenda como fuente",
    body: "La disponibilidad conectada manda. Momentum sólo confirma lo que existe."
  },
  {
    icon: ShieldCheck,
    title: "Reglas aprobadas",
    body: "Servicios, precios, políticas y límites se revisan antes de activar el piloto."
  },
  {
    icon: Clock3,
    title: "Cobertura continua",
    body: "Responde fuera de horario y deja trazabilidad para que el equipo retome con contexto."
  }
];

const operatingSignals = [
  "Paciente nuevo",
  "Tratamiento detectado",
  "Horario disponible",
  "Confirmación lista"
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <section className="hero-scene">
        <header className="site-nav" aria-label="Navegación principal">
          <a className="brand-mark" href="/">
            Momentum
          </a>
          <nav className="nav-links" aria-label="Secciones">
            <a href="#flow">Flujo</a>
            <a href="#control">Control</a>
            <a href="/lead">Piloto</a>
          </nav>
        </header>

        <div className="hero-center section-band">
          <p className="eyebrow">Momentum para clínicas estéticas</p>
          <h1>Agenda llena. Inbox liviano.</h1>
          <p className="hero-copy">
            Momentum es el operador IA que responde WhatsApp, detecta intención y reserva sobre tu
            agenda real.
          </p>
          <div className="hero-actions" aria-label="Acciones para piloto Momentum">
            <a className="primary-link" href="/lead">
              Activar piloto
            </a>
            <a className="secondary-link" href="#flow">
              Ver el flujo
            </a>
          </div>
          <div className="hero-proof" aria-label="Diferenciales Momentum">
            <span>WhatsApp nativo</span>
            <span>Agenda conectada</span>
            <span>Supervisión humana</span>
          </div>
        </div>

        <div className="product-theater" aria-label="Sistema Momentum convirtiendo WhatsApp en turno">
          <div className="momentum-os">
            <div className="os-topbar">
              <div className="window-controls" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span>Momentum Live Desk</span>
              <strong>turno confirmado</strong>
            </div>

            <div className="os-grid">
              <aside className="inbox-panel" aria-label="WhatsApp entrante">
                <div className="panel-head">
                  <span>WhatsApp</span>
                  <strong>3 nuevos</strong>
                </div>
                <div className="inbox-thread active-thread">
                  <span>Camila R.</span>
                  <p>Hola, quiero consultar por botox esta semana.</p>
                </div>
                <div className="inbox-thread">
                  <span>Lucía M.</span>
                  <p>Necesito reprogramar mi limpieza facial.</p>
                </div>
                <div className="inbox-thread">
                  <span>Sofía P.</span>
                  <p>¿Tienen lugar hoy para evaluación?</p>
                </div>
              </aside>

              <section className="operator-panel" aria-label="Decisión operativa Momentum">
                <div className="live-badge">
                  <Sparkles aria-hidden="true" />
                  Analizando intención
                </div>
                <div className="intent-card">
                  <span>Servicio</span>
                  <strong>Consulta botox</strong>
                </div>
                <div className="intent-card two">
                  <span>Urgencia</span>
                  <strong>Esta semana</strong>
                </div>
                <div className="intent-card three">
                  <span>Estado</span>
                  <strong>Lista para reservar</strong>
                </div>
                <div className="route-pulse" aria-hidden="true" />
              </section>

              <aside className="agenda-panel" aria-label="Agenda conectada">
                <div className="panel-head">
                  <span>Agenda real</span>
                  <strong>Jueves</strong>
                </div>
                <div className="agenda-row muted-row">
                  <span>16:45</span>
                  <p>Control facial</p>
                </div>
                <div className="agenda-row locked-row">
                  <span>17:30</span>
                  <p>Consulta botox</p>
                </div>
                <div className="agenda-row">
                  <span>18:15</span>
                  <p>Disponible</p>
                </div>
              </aside>
            </div>
          </div>

          <div className="command-deck" aria-label="Comando automatizado">
            <div>
              <span>Respuesta enviada</span>
              <strong>Jueves 17:30 confirmado</strong>
            </div>
            <p>Recordatorio 24 h antes + derivación si cambia el tratamiento.</p>
          </div>
        </div>
      </section>

      <section className="belief-section section-band">
        <p className="eyebrow">Diseñado para clínicas que convierten</p>
        <h2>No es otro chatbot. Es una capa operativa para convertir demanda en turnos.</h2>
        <p>
          El paciente no quiere esperar una respuesta, comparar capturas ni repetir datos. Quiere
          saber si puede reservar. Momentum transforma esa intención en agenda con control.
        </p>
      </section>

      <section id="flow" className="flow-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Flujo operativo</p>
          <h2>Del primer mensaje al turno confirmado, sin llenar la pantalla de fricción.</h2>
        </div>
        <div className="flow-rail">
          {flowSteps.map((step) => {
            const Icon = step.icon;
            return (
              <article className="flow-step" key={step.title}>
                <span className="step-label">{step.label}</span>
                <Icon aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="operating-section">
        <div className="section-band operating-layout">
          <div>
            <p className="eyebrow">Superficie de automatización</p>
            <h2>Lo repetido se mueve solo. Lo sensible queda bajo control.</h2>
          </div>
          <div className="automation-list" aria-label="Automatizaciones de Momentum">
            {automations.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section id="control" className="control-section section-band">
        <div className="section-heading">
          <p className="eyebrow">Capa de control</p>
          <h2>La IA opera, tu clínica define los límites.</h2>
          <p>
            Momentum se activa con revisión asistida: agenda, reglas, derivaciones y tono se
            configuran antes de hablar con pacientes reales.
          </p>
        </div>
        <div className="control-grid">
          {controlPoints.map((control) => {
            const Icon = control.icon;
            return (
              <article className="control-card" key={control.title}>
                <Icon aria-hidden="true" />
                <h3>{control.title}</h3>
                <p>{control.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="signal-section section-band">
        <div className="signal-board" aria-label="Señales operativas Momentum">
          {operatingSignals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
        <div className="final-cta">
          <p className="eyebrow">Piloto asistido</p>
          <h2>Convertí WhatsApp en una recepción de alto rendimiento.</h2>
          <p>
            Revisamos tu clínica, tu agenda y tus reglas antes de activar una experiencia
            controlada con pacientes reales.
          </p>
          <a className="primary-link" href="/lead">
            Solicitar revisión
          </a>
        </div>
      </section>
    </main>
  );
}
