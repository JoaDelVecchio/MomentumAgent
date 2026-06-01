import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const landing = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const lead = readFileSync(new URL("../src/app/lead/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("public landing uses Cluely-inspired Spanish product positioning", () => {
  assert.match(landing, /Agenda llena\. Inbox liviano\./);
  assert.match(landing, /Activar piloto/);
  assert.match(landing, /Ver el flujo/);
  assert.match(landing, /No es otro chatbot\. Es una capa operativa para convertir demanda en turnos\./);
  assert.match(landing, /product-theater/);
  assert.match(landing, /whatsapp-stage/);
  assert.match(landing, /whatsapp-web/);
  assert.match(landing, /whatsapp-message/);
  assert.match(landing, /whatsapp-composer/);
  assert.match(landing, /whatsapp-browser-bar/);
  assert.match(landing, /web\.whatsapp\.com/);
  assert.match(landing, /WhatsApp conectado/);
  assert.match(landing, /Momentum IA/);
  assert.match(landing, /soy el asistente de Clínica Aura/);
  assert.match(landing, /Turno creado · jue 17:30/);
  assert.doesNotMatch(landing, /La recepción IA que convierte WhatsApp en turnos confirmados\./);
  assert.doesNotMatch(landing, /momentum-os|os-grid|operator-panel|agenda-panel/);
  assert.doesNotMatch(landing, /chat-phone|chat-sidecar|booking-receipt|insight-card|command-deck/);
  assert.doesNotMatch(landing, /mock-phone/);
  assert.doesNotMatch(landing, /Turn WhatsApp into your clinic&apos;s appointment engine/);
  assert.doesNotMatch(landing, /AI receptionist for aesthetic clinics/);
});

test("lead application keeps behavior while presenting the redesigned pilot request", () => {
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

test("document metadata is localized for the public Spanish experience", () => {
  assert.match(layout, /Momentum \| Recepción IA para clínicas estéticas/);
  assert.match(layout, /Convertí WhatsApp en turnos confirmados con Momentum/);
  assert.doesNotMatch(layout, /AI receptionist for aesthetic clinics/);
  assert.doesNotMatch(layout, /Turn WhatsApp conversations into confirmed appointments/);
});

test("public CSS uses a clean Cluely-style glass palette without the old grid treatment", () => {
  assert.match(css, /\.product-theater/);
  assert.match(css, /\.whatsapp-stage/);
  assert.match(css, /\.whatsapp-browser-bar/);
  assert.match(css, /\.whatsapp-web/);
  assert.match(css, /\.whatsapp-message/);
  assert.match(css, /\.whatsapp-agent-toast/);
  assert.match(css, /\.whatsapp-composer/);
  assert.match(css, /--page: #eef2f8;/);
  assert.match(css, /--glass: rgba\(255, 255, 255, 0\.72\);/);
  assert.match(css, /backdrop-filter: blur\(24px\)/);
  assert.match(css, /\.lead-intro\s*\{[\s\S]*color: var\(--ink\);/);
  assert.match(css, /@keyframes theaterReveal/);
  assert.match(css, /@keyframes messageIn/);
  assert.match(css, /@keyframes typingBlink/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.momentum-os|\.os-grid|\.operator-panel|\.agenda-panel/);
  assert.doesNotMatch(css, /\.chat-phone|\.chat-sidecar|\.booking-receipt|\.insight-card|\.command-deck/);
  assert.doesNotMatch(css, /\.mock-phone/);
  assert.doesNotMatch(css, /#f4efe5|#fffaf0|#ff6f4d|#c7912c/);
  assert.doesNotMatch(css, /background-size: 88px 88px|background-size: 74px 74px/);
  assert.doesNotMatch(css, /linear-gradient\(rgba\(22, 18, 13, 0\.055\) 1px/);
  assert.doesNotMatch(css, /linear-gradient\(rgba\(255, 250, 240, 0\.06\) 1px/);
  assert.doesNotMatch(css, /var\(--night\) 0 370px|var\(--night\) 0 560px/);
});
