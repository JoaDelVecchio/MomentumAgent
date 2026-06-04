import MomentumScene from "./momentum-scene";

const features = [
  {
    title: "Atiende 24/7",
    body: "Responde al instante, de día o de noche."
  },
  {
    title: "Agenda sola",
    body: "Reserva, reprograma y cancela en el chat."
  },
  {
    title: "Recordatorios",
    body: "Avisa antes de cada turno, sin pedirlo."
  },
  {
    title: "Menos ausencias",
    body: "Confirmaciones que recuperan no-shows."
  }
];

export default function HomePage() {
  return (
    <div className="landing-shell">
      <header className="landing-nav" aria-label="Navegación principal">
        <a className="brand" href="/">
          <span className="brand-dot" />
          <span className="brand-name">Momentum</span>
        </a>
        <div className="landing-nav-right">
          <nav className="landing-nav-links" aria-label="Secciones">
            <a className="landing-nav-link" href="#features">
              Cómo funciona
            </a>
            <a className="landing-nav-link" href="/lead">
              Precios
            </a>
          </nav>
          <a className="btn btn-primary" href="/lead">
            Agendar una llamada
            <span className="arrow">→</span>
          </a>
        </div>
      </header>

      <main className="landing-main">
        <section className="copy" aria-label="Recepcionista IA para clínicas">
          <div className="eyebrow">
            <span className="live" />
            Recepcionista IA · WhatsApp
          </div>
          <h1 className="landing-title">
            <span>No pierdas</span>
            <span>
              ni un <span className="em">cliente</span>.
            </span>
          </h1>
          <p className="sub">
            Momentum atiende a tus clientes, agenda, reprograma y recuerda cada turno por WhatsApp.
            Conectado a tu calendario, las 24 horas — para que no quede ni un hueco libre en tu agenda.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="/lead">
              Agendar una llamada
              <span className="arrow">→</span>
            </a>
            <a className="text-link" href="#conversation">
              Ver una conversación real
              <span className="pl">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 5l9 7-9 7V5z" fill="currentColor" />
                </svg>
              </span>
            </a>
          </div>
          <div className="trust">
            <span className="gcal">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="2.6" stroke="var(--ink-faint)" strokeWidth="1.7" />
                <path
                  d="M3.5 9.5h17M8 3.5v3M16 3.5v3"
                  stroke="var(--ink-faint)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            Se sincroniza con Google Calendar
          </div>
        </section>

        <section id="conversation" className="stage-col" aria-label="Conversación y agenda Momentum">
          <MomentumScene />
        </section>
      </main>

      <footer id="features" className="landing-feats" aria-label="Funciones de Momentum">
        {features.map((feature) => (
          <div className="feat" key={feature.title}>
            <div className="feat-h">
              <span className="d" />
              {feature.title}
            </div>
            <div className="feat-p">{feature.body}</div>
          </div>
        ))}
      </footer>
    </div>
  );
}
