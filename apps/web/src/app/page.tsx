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

        <div className="product-theater whatsapp-theater" aria-label="Agente Momentum operando en WhatsApp">
          <div className="whatsapp-stage">
            <div className="whatsapp-browser-bar" aria-hidden="true">
              <span className="browser-controls">
                <i />
                <i />
                <i />
              </span>
              <strong>web.whatsapp.com</strong>
              <span>Agente activo</span>
            </div>
            <section className="whatsapp-web real-whatsapp-shot" aria-label="WhatsApp Web con agente Momentum">
              <aside className="whatsapp-rail" aria-hidden="true">
                <span className="rail-icon active" />
                <span className="rail-icon" />
                <span className="rail-icon" />
                <span className="rail-spacer" />
                <span className="rail-avatar">A</span>
              </aside>

              <aside className="whatsapp-sidebar" aria-label="Lista de chats de WhatsApp">
                <div className="whatsapp-sidebar-head">
                  <div className="clinic-avatar">A</div>
                  <div>
                    <span>Clínica Aura</span>
                    <strong>WhatsApp conectado</strong>
                  </div>
                  <div className="whatsapp-icons" aria-hidden="true">
                    <span />
                    <span />
                  </div>
                </div>
                <div className="whatsapp-search">
                  <span aria-hidden="true" />
                  Buscar o empezar un chat
                </div>
                <div className="whatsapp-filter-row" aria-hidden="true">
                  <span className="active">Todos</span>
                  <span>No leídos</span>
                  <span>Favoritos</span>
                </div>
                <div className="whatsapp-chat-row active">
                  <div className="wa-avatar">C</div>
                  <div>
                    <span>Camila R.</span>
                    <p>
                      <b>Momentum:</b> turno creado.
                    </p>
                  </div>
                  <time>10:16</time>
                </div>
                <div className="whatsapp-chat-row">
                  <div className="wa-avatar muted">L</div>
                  <div>
                    <span>Lucía M.</span>
                    <p>Necesito reprogramar mi limpieza.</p>
                  </div>
                  <time>9:48</time>
                </div>
                <div className="whatsapp-chat-row">
                  <div className="wa-avatar muted">S</div>
                  <div>
                    <span>Sofía P.</span>
                    <p>¿Tienen evaluación hoy?</p>
                  </div>
                  <time>9:31</time>
                </div>
              </aside>

              <section className="whatsapp-conversation" aria-label="Conversación real del agente">
                <header className="whatsapp-header">
                  <div className="wa-avatar">C</div>
                  <div>
                    <span>Camila R.</span>
                    <p>online</p>
                  </div>
                  <span className="whatsapp-header-action" aria-hidden="true">
                    Momentum escucha
                  </span>
                </header>

                <div className="whatsapp-thread">
                  <div className="whatsapp-date">Hoy</div>
                  <div className="whatsapp-message inbound">
                    <p>Hola! Quería saber si tienen turno para botox esta semana.</p>
                    <time>10:14</time>
                  </div>
                  <div className="whatsapp-message outbound agent-response">
                    <span className="agent-label">Asistente de Clínica Aura</span>
                    <p>
                      Hola Camila, soy el asistente de Clínica Aura. Tengo jueves 17:30 o viernes
                      12:00 para evaluación. ¿Cuál preferís?
                    </p>
                    <time>
                      10:14 <span>✓✓</span>
                    </time>
                  </div>
                  <div className="whatsapp-message inbound">
                    <p>Jueves 17:30 me sirve.</p>
                    <time>10:15</time>
                  </div>
                  <div className="whatsapp-message outbound confirmed">
                    <span className="agent-label">Confirmación automática</span>
                    <p>
                      Listo, te reservé jueves 17:30 con la Dra. Mora. Te escribo 24 h antes para
                      confirmar.
                    </p>
                    <time>
                      10:15 <span>✓✓</span>
                    </time>
                  </div>
                </div>

                <div className="whatsapp-agent-lens" aria-label="Lectura del agente Momentum">
                  <span>Momentum</span>
                  <strong>Intención: reservar botox</strong>
                  <p>Acción: ofrece horarios reales y crea el turno.</p>
                </div>

                <div className="whatsapp-agent-toast" aria-label="Acción del agente en agenda">
                  <span>Agenda actualizada</span>
                  <strong>Turno creado · jue 17:30</strong>
                </div>

                <div className="whatsapp-composer" aria-label="Campo de mensaje de WhatsApp">
                  <span className="whatsapp-attach" aria-hidden="true">+</span>
                  <span className="whatsapp-input">Mensaje</span>
                  <strong>Momentum responde automáticamente</strong>
                </div>
              </section>
            </section>
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
