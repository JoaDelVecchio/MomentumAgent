"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

const STAGE_W = 560;
const STAGE_H = 600;

const SCRIPT: Array<{
  who: "client" | "agent";
  text: string;
  t: string;
  books?: boolean;
}> = [
  { who: "client", text: "Hola! Quería sacar un turno.", t: "09:41" },
  { who: "agent", text: "¡Hola, Lucía! Con gusto. ¿Qué día te viene bien?", t: "09:41" },
  { who: "client", text: "El martes a la tarde si se puede.", t: "09:41" },
  { who: "agent", text: "Tengo libre a las 14:00 y 16:30. ¿Cuál preferís?", t: "09:42" },
  { who: "client", text: "A las 14 perfecto.", t: "09:42" },
  {
    who: "agent",
    text: "Listo, te agendé el martes 14:00. Te escribo un recordatorio el día antes.",
    t: "09:42",
    books: true
  }
];

export default function MomentumScene() {
  const { visible, typing, booked, reminder, fade, flowing } = useConversation();
  const messages = SCRIPT.slice(0, visible);
  const flowDotStyle = {
    offsetPath: "path('M296 300 C 332 250, 320 185, 332 168')",
    offsetDistance: flowing ? "100%" : "0%",
    opacity: flowing ? 1 : 0,
    transition: flowing
      ? "offset-distance 1.0s cubic-bezier(.5,0,.2,1), opacity .25s"
      : "opacity .3s"
  } as CSSProperties;

  return (
    <ScaleFit w={STAGE_W} h={STAGE_H}>
      <div style={sc.scene}>
        <svg style={sc.flow} viewBox="0 0 560 600" fill="none" aria-hidden="true">
          <path
            d="M296 300 C 332 250, 320 185, 332 168"
            stroke="var(--line)"
            strokeWidth="2"
            strokeDasharray="2 7"
            strokeLinecap="round"
          />
          <circle r="5" fill="var(--accent)" style={flowDotStyle} />
        </svg>

        <div className="card" style={{ ...sc.card, ...sc.chat }}>
          <div style={sc.chatHead}>
            <span style={sc.avatar}>L</span>
            <div style={{ lineHeight: 1.2, minWidth: 0 }}>
              <div style={sc.chatName}>Lucía M.</div>
              <div style={sc.chatMeta}>
                <span style={sc.onDot} />
                en línea
              </div>
            </div>
            <span style={sc.wa}>Cliente</span>
          </div>

          <div style={{ ...sc.msgs, opacity: fade ? 0 : 1 }}>
            {messages.map((message, index) => (
              <Message key={`${message.t}:${index}`} who={message.who} time={message.t}>
                {message.text}
              </Message>
            ))}
            {typing ? (
              <div
                style={{
                  ...sc.bubble,
                  ...sc.bIn,
                  ...sc.typing,
                  animation: "msgIn .35s cubic-bezier(.2,.7,.2,1) both"
                }}
              >
                <Dots />
              </div>
            ) : null}
          </div>

          <div style={sc.inputBar}>
            <span style={sc.botDot} />
            <span style={sc.inputTxt}>Momentum responde por vos</span>
            <span style={sc.onTag}>Activo</span>
          </div>
        </div>

        <div className="card" style={{ ...sc.card, ...sc.cal }}>
          <div style={sc.calHead}>
            <span style={sc.calTitle}>Martes 14</span>
            <span style={sc.sync}>
              <span style={{ ...sc.syncDot, ...(booked ? { background: "var(--accent)" } : {}) }} />
              Calendar
            </span>
          </div>
          <Slot time="13:00" />
          <Slot time="14:00" booked={booked} name="Lucía M." />
          <Slot time="16:30" muted />
        </div>

        <div
          className="card"
          style={{
            ...sc.card,
            ...sc.rem,
            opacity: reminder ? 1 : 0,
            transform: reminder ? "translateY(0)" : "translateY(14px)"
          }}
        >
          <div style={sc.remHead}>
            <span style={sc.bell}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"
                  stroke="var(--accent-ink)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path d="M10 20a2 2 0 0 0 4 0" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span style={sc.remTitle}>Recordatorio automático</span>
            <span style={sc.remTag}>1 día antes</span>
          </div>
          <div style={sc.remBubble}>
            Hola Lucía, te recordamos tu turno mañana a las <b style={{ fontWeight: 700 }}>14:00</b>. ¡Te esperamos!
          </div>
          <div style={sc.remNote}>
            <Check s={12} />
            Enviado automáticamente · reduce ausencias
          </div>
        </div>
      </div>
    </ScaleFit>
  );
}

function useConversation() {
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState(false);
  const [booked, setBooked] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [fade, setFade] = useState(false);
  const [flowing, setFlowing] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVisible(SCRIPT.length);
      setBooked(true);
      setReminder(true);
      return;
    }

    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms);
        timers.push(id);
      });

    async function run() {
      while (!cancelled) {
        setFade(false);
        setVisible(0);
        setTyping(false);
        setBooked(false);
        setReminder(false);
        setFlowing(false);
        await wait(650);
        if (cancelled) return;

        for (let index = 0; index < SCRIPT.length; index += 1) {
          const message = SCRIPT[index];
          if (message.who === "agent") {
            setTyping(true);
            await wait(1150);
            if (cancelled) return;
            setTyping(false);
          } else {
            await wait(820);
            if (cancelled) return;
          }

          setVisible(index + 1);
          if (message.books) {
            await wait(450);
            if (cancelled) return;
            setFlowing(true);
            await wait(550);
            setBooked(true);
            await wait(900);
            if (cancelled) return;
            setReminder(true);
          }

          await wait(message.who === "agent" ? 950 : 720);
          if (cancelled) return;
        }

        await wait(3000);
        if (cancelled) return;
        setFade(true);
        await wait(520);
      }
    }

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return { visible, typing, booked, reminder, fade, flowing };
}

function Message({ who, time, children }: { who: "client" | "agent"; time: string; children: ReactNode }) {
  const isInbound = who === "client";

  return (
    <div
      style={{
        ...sc.bubble,
        ...(isInbound ? sc.bIn : sc.bOut),
        animation: "msgIn .42s cubic-bezier(.2,.7,.2,1) both"
      }}
    >
      <span>{children}</span>
      <span style={{ ...sc.meta, ...(isInbound ? {} : { color: "var(--accent-ink)" }) }}>
        {time}
        {!isInbound ? <Ticks /> : null}
      </span>
    </div>
  );
}

function Slot({ time, booked, name, muted }: { time: string; booked?: boolean; name?: string; muted?: boolean }) {
  return (
    <div
      style={{
        ...sc.slot,
        ...(booked ? sc.slotBooked : {}),
        transition: "background .5s, border-color .5s"
      }}
    >
      <span
        style={{
          ...sc.slotTime,
          ...(booked ? { color: "var(--accent-ink)" } : {}),
          ...(muted ? { opacity: 0.5 } : {})
        }}
      >
        {time}
      </span>
      {booked ? (
        <div style={{ ...sc.slotBody, animation: "slotIn .5s .12s both" }}>
          <span style={sc.slotBar} />
          <span style={sc.slotLabel}>{name} · Turno</span>
          <span style={{ marginLeft: "auto", display: "flex" }}>
            <Check s={14} />
          </span>
        </div>
      ) : (
        <span style={{ ...sc.slotEmpty, ...(muted ? { opacity: 0.5 } : {}) }} />
      )}
    </div>
  );
}

function ScaleFit({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const ro = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setScale(Math.min(rect.width / w, rect.height / h, 1.05));
    });

    ro.observe(element);
    return () => ro.disconnect();
  }, [w, h]);

  return (
    <div ref={ref} className="stage-fit">
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "center center" }}>
        {children}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "2px 1px" }}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--ink-faint)",
            animation: `bd 1s ${index * 0.16}s infinite ease-in-out`
          }}
        />
      ))}
    </span>
  );
}

function Check({ s = 13, c = "var(--accent)" }: { s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.8 10 17.5 19 6.5" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Ticks() {
  return (
    <svg width="16" height="11" viewBox="0 0 20 12" fill="none" aria-hidden="true" style={{ marginLeft: 2 }}>
      <path d="M2 6.4 5 9.4 11 2.6" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6.4 11 9.4 17 2.6" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const sc: Record<string, CSSProperties> = {
  scene: { position: "relative", width: STAGE_W, height: STAGE_H },
  flow: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" },
  card: {
    position: "absolute",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 20,
    boxShadow: "var(--shadow-md)"
  },
  chat: {
    left: 0,
    top: 8,
    width: 296,
    height: 472,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    animation: "floatA 7s ease-in-out infinite",
    zIndex: 1
  },
  chatHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBottom: 13,
    borderBottom: "1px solid var(--line-soft)"
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "var(--accent-soft)",
    color: "var(--accent-ink)",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 15,
    flexShrink: 0
  },
  chatName: { fontWeight: 700, fontSize: 14.5, letterSpacing: "-.01em", whiteSpace: "nowrap" },
  chatMeta: {
    fontSize: 11.5,
    color: "var(--ink-faint)",
    display: "flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap"
  },
  onDot: { width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" },
  wa: {
    marginLeft: "auto",
    fontFamily: "var(--mono)",
    fontSize: 9.5,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--ink-faint)",
    flexShrink: 0
  },
  msgs: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 8,
    padding: "14px 0 12px",
    transition: "opacity .5s",
    WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)",
    maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)"
  },
  bubble: {
    maxWidth: "82%",
    padding: "8px 11px 6px",
    fontSize: 13,
    lineHeight: 1.38,
    borderRadius: 15,
    display: "flex",
    flexDirection: "column",
    gap: 1
  },
  bIn: {
    alignSelf: "flex-start",
    background: "var(--bg-2)",
    color: "var(--ink)",
    borderBottomLeftRadius: 5
  },
  bOut: {
    alignSelf: "flex-end",
    background: "var(--accent-soft)",
    color: "var(--ink)",
    borderBottomRightRadius: 5,
    border: "1px solid color-mix(in oklab, var(--accent) 16%, transparent)"
  },
  typing: { alignSelf: "flex-start", padding: "11px 13px" },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    fontSize: 9.5,
    color: "var(--ink-faint)",
    fontFamily: "var(--mono)",
    marginTop: 1
  },
  inputBar: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
    padding: "9px 11px",
    background: "var(--bg-2)",
    borderRadius: 12,
    overflow: "hidden"
  },
  botDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
    boxShadow: "0 0 0 3px var(--accent-soft)"
  },
  inputTxt: {
    fontSize: 12,
    color: "var(--ink-soft)",
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  onTag: {
    fontFamily: "var(--mono)",
    fontSize: 9,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "var(--accent-ink)",
    background: "var(--accent-soft)",
    padding: "4px 8px",
    borderRadius: 999,
    flexShrink: 0,
    lineHeight: 1
  },
  cal: { right: 0, top: 44, width: 248, padding: 16, animation: "floatB 8s ease-in-out infinite", zIndex: 3 },
  calHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  calTitle: { fontWeight: 700, fontSize: 15, letterSpacing: "-.01em", whiteSpace: "nowrap" },
  sync: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--mono)",
    fontSize: 10.5,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-faint)"
  },
  syncDot: { width: 7, height: 7, borderRadius: "50%", background: "var(--line)", transition: "background .4s" },
  slot: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    height: 44,
    padding: "0 11px",
    borderRadius: 11,
    border: "1px solid transparent",
    marginBottom: 6
  },
  slotBooked: {
    background: "var(--accent-soft)",
    border: "1px solid color-mix(in oklab, var(--accent) 22%, transparent)"
  },
  slotTime: { fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-faint)", width: 40, flexShrink: 0 },
  slotBody: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  slotBar: { width: 3, height: 18, borderRadius: 3, background: "var(--accent)", flexShrink: 0 },
  slotLabel: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-ink)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  slotEmpty: { flex: 1, height: 2, borderRadius: 2, background: "var(--line-soft)" },
  rem: {
    right: 0,
    top: 284,
    width: 248,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    zIndex: 4,
    transition: "opacity .5s cubic-bezier(.2,.7,.2,1), transform .5s cubic-bezier(.2,.7,.2,1)"
  },
  remHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 11 },
  bell: {
    width: 28,
    height: 28,
    borderRadius: 9,
    background: "var(--accent-soft)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0
  },
  remTitle: { fontWeight: 700, fontSize: 12.5, letterSpacing: "-.01em", flex: 1, whiteSpace: "nowrap" },
  remTag: {
    fontFamily: "var(--mono)",
    fontSize: 9,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--accent-ink)",
    background: "var(--accent-soft)",
    padding: "3px 7px",
    borderRadius: 999,
    flexShrink: 0
  },
  remBubble: {
    fontSize: 12,
    lineHeight: 1.42,
    color: "var(--ink)",
    background: "var(--accent-soft)",
    border: "1px solid color-mix(in oklab, var(--accent) 16%, transparent)",
    borderRadius: 13,
    borderBottomRightRadius: 5,
    padding: "9px 11px",
    marginBottom: 11
  },
  remNote: {
    marginTop: 11,
    paddingTop: 10,
    borderTop: "1px solid var(--line-soft)",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "var(--ink-faint)",
    display: "flex",
    alignItems: "center",
    gap: 7
  }
};
