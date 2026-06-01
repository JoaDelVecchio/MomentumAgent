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
  assert.match(landing, /momentum-os/);
  assert.match(landing, /command-deck/);
  assert.doesNotMatch(landing, /La recepción IA que convierte WhatsApp en turnos confirmados\./);
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

test("public CSS includes the redesigned product theater and reduced-motion fallback", () => {
  assert.match(css, /\.product-theater/);
  assert.match(css, /\.momentum-os/);
  assert.match(css, /\.command-deck/);
  assert.match(css, /@keyframes theaterReveal/);
  assert.match(css, /@keyframes routePulse/);
  assert.match(css, /@keyframes bookingLock/);
  assert.match(css, /@keyframes commandFloat/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.mock-phone/);
});
