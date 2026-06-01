# Public UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the public Momentum landing and lead form into a premium Spanish product experience without behavior changes.

**Architecture:** Keep the existing Next.js App Router structure. Modify only public page markup/copy, lead page markup/copy, shared CSS styling, package scripts for a focused UI test, and a static test file. Preserve all route paths, API calls, form field names, state keys, and submit handlers.

**Tech Stack:** Next.js 16, React 19, TypeScript, lucide-react, Node test runner, CSS animations.

---

## File Structure

- `apps/web/src/app/page.tsx`: Spanish public landing markup, visual product mockup, and existing `/lead` and `#flow` navigation.
- `apps/web/src/app/lead/page.tsx`: Spanish lead application copy and layout classes while preserving `initialForm`, `painOptions` values, `handleSubmit`, and `submitClinicLead`.
- `apps/web/src/app/globals.css`: public visual system, product mockup, motion, responsive rules, and reduced-motion fallback. Internal classes remain functional.
- `apps/web/package.json`: add a `test:ui` script for the static UI contract test.
- `apps/web/tests/public-ui.test.mjs`: static contract test for public copy, motion hooks, and reduced-motion support.

---

### Task 1: Public UI Contract Test

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/tests/public-ui.test.mjs`

- [ ] **Step 1: Add the UI test script**

Add this script to `apps/web/package.json`:

```json
"test:ui": "node --test tests/public-ui.test.mjs"
```

- [ ] **Step 2: Create the failing static UI test**

Create `apps/web/tests/public-ui.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const landing = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const lead = readFileSync(new URL("../src/app/lead/page.tsx", import.meta.url), "utf8");
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

test("public CSS includes product mockup motion and reduced-motion fallback", () => {
  assert.match(css, /\.operator-stage/);
  assert.match(css, /\.signal-line/);
  assert.match(css, /@keyframes messageRise/);
  assert.match(css, /@keyframes signalTravel/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
npm --workspace apps/web run test:ui
```

Expected: FAIL because the current landing and lead pages still use English copy and the CSS does not yet contain the new mockup classes.

---

### Task 2: Landing Markup And Copy

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Replace public landing content only**

Implement Spanish arrays and markup in `apps/web/src/app/page.tsx` while preserving:

```tsx
<a className="primary-link" href="/lead">
<a className="secondary-link" href="#flow">
<section id="flow" className="flow-section section-band">
```

Required public text:

```txt
La recepción IA que convierte WhatsApp en turnos confirmados.
Activar piloto
Ver cómo funciona
No es un bot genérico. Es un operador entrenado para convertir demanda real en agenda real.
Agenda real. Conversaciones reales. Turnos confirmados.
Empezá con un piloto asistido.
```

Required mockup class hooks:

```txt
operator-stage
signal-line
intent-panel
booking-card
```

- [ ] **Step 2: Run the UI test**

Run:

```bash
npm --workspace apps/web run test:ui
```

Expected: still FAIL until the lead page and CSS are updated.

---

### Task 3: Lead Page Markup And Copy

**Files:**
- Modify: `apps/web/src/app/lead/page.tsx`

- [ ] **Step 1: Translate and polish the lead page**

Preserve these behavior-sensitive lines:

```tsx
await submitClinicLead(form);
setForm(initialForm);
name="contactName"
name="clinicName"
name="whatsappOrPhone"
name="city"
name="country"
name="professionalCount"
name="monthlyWhatsappInquiries"
name="currentSchedulingSystem"
name="mainPain"
```

Required public text:

```txt
Solicitud de piloto
Activá Momentum con una revisión asistida.
Contanos cómo tu clínica gestiona WhatsApp, agenda y seguimiento hoy.
Nombre y apellido
Nombre de la clínica
WhatsApp o teléfono
Enviar solicitud
Enviando...
```

- [ ] **Step 2: Run the UI test**

Run:

```bash
npm --workspace apps/web run test:ui
```

Expected: still FAIL until CSS motion hooks and reduced-motion support are updated.

---

### Task 4: Visual System, Mockup, Motion, And Responsive CSS

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Implement the premium public CSS**

Update the public CSS to include:

```css
.operator-stage { position: relative; }
.signal-line { position: absolute; }
.intent-panel { position: absolute; }
.booking-card { position: absolute; }
@keyframes messageRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes signalTravel { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Keep `.primary-link`, `.secondary-link`, `.lead-form`, `.internal-*`, `.form-status`, and responsive breakpoints functional.

- [ ] **Step 2: Run the UI test and verify GREEN**

Run:

```bash
npm --workspace apps/web run test:ui
```

Expected: PASS.

---

### Task 5: Typecheck, Build, And Browser Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run web typecheck**

Run:

```bash
npm run typecheck:web
```

Expected: exit 0.

- [ ] **Step 2: Run web build**

Run:

```bash
npm run build:web
```

Expected: exit 0.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev:web
```

Expected: Next.js starts on `http://127.0.0.1:3001`.

- [ ] **Step 4: Browser verify `/` and `/lead`**

Open:

```txt
http://127.0.0.1:3001/
http://127.0.0.1:3001/lead
```

Expected:

- landing renders without console errors;
- hero visual is visible on desktop and mobile;
- `/lead` form renders all existing fields;
- CTA links still point to `/lead` and `#flow`;
- text does not overlap at desktop or mobile viewport widths.

---

## Self-Review

- Spec coverage: landing, lead page, motion, accessibility, and behavior preservation are covered by Tasks 1-5.
- Placeholder scan: no placeholder steps remain.
- Type consistency: all referenced file paths and form field names match the current codebase.
