import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const landing = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const scene = readFileSync(new URL("../src/app/momentum-scene.tsx", import.meta.url), "utf8");
const lead = readFileSync(new URL("../src/app/lead/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("public landing follows the supplied Momentum ZIP design contract", () => {
  assert.match(landing, /Recepcionista IA · WhatsApp/);
  assert.match(landing, /No pierdas/);
  assert.match(landing, /ni un <span className="em">cliente<\/span>\./);
  assert.match(landing, /Momentum atiende a tus clientes, agenda, reprograma y recuerda cada turno por WhatsApp/);
  assert.match(landing, /Agendar una llamada/);
  assert.match(landing, /Ver una conversación real/);
  assert.match(landing, /Se sincroniza con Google Calendar/);
  assert.match(landing, /Atiende 24\/7/);
  assert.match(landing, /Agenda sola/);
  assert.match(landing, /Recordatorios/);
  assert.match(landing, /Menos ausencias/);
  assert.match(landing, /MomentumScene/);
  assert.match(landing, /landing-shell/);
  assert.match(landing, /landing-main/);
  assert.match(landing, /landing-feats/);
  assert.doesNotMatch(landing, /product-theater|whatsapp-stage|whatsapp-web|real-whatsapp-shot/);
  assert.doesNotMatch(landing, /Agenda llena\. Inbox liviano\./);
});

test("animated scene preserves the supplied booking and reminder interaction", () => {
  assert.match(scene, /"use client"/);
  assert.match(scene, /Hola! Quería sacar un turno/);
  assert.match(scene, /Tengo libre a las 14:00 y 16:30/);
  assert.match(scene, /Listo, te agendé el martes 14:00/);
  assert.match(scene, /Recordatorio automático/);
  assert.match(scene, /Momentum responde por vos/);
  assert.match(scene, /ResizeObserver/);
  assert.match(scene, /prefers-reduced-motion: reduce/);
});

test("lead application keeps behavior while presenting the refreshed pilot request", () => {
  assert.match(lead, /Solicitud de piloto/);
  assert.match(lead, /Tu piloto empieza con contexto/);
  assert.match(lead, /Diagnóstico operativo/);
  assert.match(lead, /Nombre y apellido/);
  assert.match(lead, /Enviar solicitud/);
  assert.match(lead, /submitClinicLead\(form\)/);
  assert.match(lead, /name="contactName"/);
  assert.match(lead, /name="clinicName"/);
  assert.match(lead, /name="whatsappOrPhone"/);
  assert.match(lead, /name="professionalCount"/);
  assert.match(lead, /name="monthlyWhatsappInquiries"/);
  assert.match(lead, /name="currentSchedulingSystem"/);
  assert.match(lead, /name="mainPain"/);
});

test("document metadata and fonts are localized for the public Spanish experience", () => {
  assert.match(layout, /Momentum \| Recepción IA para clínicas estéticas/);
  assert.match(layout, /Convertí WhatsApp en turnos confirmados con Momentum/);
  assert.match(layout, /api\.fontshare\.com/);
  assert.match(layout, /JetBrains\+Mono/);
  assert.doesNotMatch(layout, /AI receptionist for aesthetic clinics/);
  assert.doesNotMatch(layout, /Turn WhatsApp conversations into confirmed appointments/);
});

test("public CSS uses the supplied light Momentum tokens across all web paths", () => {
  assert.match(css, /--bg: oklch\(0\.986 0\.004 95\);/);
  assert.match(css, /--accent: oklch\(0\.64 0\.118 158\);/);
  assert.match(css, /--sans: "Satoshi"/);
  assert.match(css, /\.landing-shell/);
  assert.match(css, /\.landing-main/);
  assert.match(css, /\.landing-feats/);
  assert.match(css, /\.stage-fit/);
  assert.match(css, /\.lead-shell/);
  assert.match(css, /\.internal-shell/);
  assert.match(css, /\.test-chat-thread/);
  assert.match(css, /@keyframes msgIn/);
  assert.match(css, /@keyframes slotIn/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /--page: #eef2f8/);
  assert.doesNotMatch(css, /--glass: rgba\(255, 255, 255, 0\.72\)/);
  assert.doesNotMatch(css, /product-theater|whatsapp-stage|whatsapp-web/);
  assert.doesNotMatch(css, /#08090d 0%|var\(--night\)/);
});
