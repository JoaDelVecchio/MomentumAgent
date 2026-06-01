import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const landing = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const lead = readFileSync(new URL("../src/app/lead/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("public landing uses approved Spanish premium positioning", () => {
  assert.match(landing, /La recepción IA que convierte WhatsApp en turnos confirmados\./);
  assert.match(landing, /Activar piloto/);
  assert.match(landing, /Ver cómo funciona/);
  assert.match(landing, /No es un bot genérico/);
  assert.doesNotMatch(landing, /Turn WhatsApp into your clinic&apos;s appointment engine/);
  assert.doesNotMatch(landing, /AI receptionist for aesthetic clinics/);
});

test("lead application keeps the same form while presenting Spanish reviewed-pilot copy", () => {
  assert.match(lead, /Solicitud de piloto/);
  assert.match(lead, /Activá Momentum con una revisión asistida/);
  assert.match(lead, /Nombre y apellido/);
  assert.match(lead, /Enviar solicitud/);
  assert.match(lead, /submitClinicLead\(form\)/);
  assert.match(lead, /name="professionalCount"/);
  assert.match(lead, /name="monthlyWhatsappInquiries"/);
});

test("document metadata is localized for the public Spanish experience", () => {
  assert.match(layout, /Momentum \| Recepción IA para clínicas estéticas/);
  assert.match(layout, /Convertí WhatsApp en turnos confirmados con Momentum/);
  assert.doesNotMatch(layout, /AI receptionist for aesthetic clinics/);
  assert.doesNotMatch(layout, /Turn WhatsApp conversations into confirmed appointments/);
});

test("public CSS includes product mockup motion and reduced-motion fallback", () => {
  assert.match(css, /\.operator-stage/);
  assert.match(css, /\.signal-line/);
  assert.match(css, /@keyframes messageRise/);
  assert.match(css, /@keyframes signalTravel/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
