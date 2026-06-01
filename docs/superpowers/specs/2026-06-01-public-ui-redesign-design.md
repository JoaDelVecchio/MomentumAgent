# Public UI Redesign Design

Date: 2026-06-01
Status: Approved for implementation

## Summary

Momentum needs a deep public UI redesign without behavior changes. The new public experience should feel like a premium AI operator for aesthetic clinics: minimal in copy, strong in product storytelling, polished in motion, and clearly specialized in WhatsApp-to-calendar conversion.

The redesign covers the public landing page at `/` and the public lead application at `/lead`. Internal onboarding pages keep their current behavior and remain function-first; shared CSS can be updated only where it improves consistency without changing internal workflows.

## Goals

- Rewrite public-facing copy in Spanish.
- Make Momentum immediately understandable as a specialized AI receptionist for aesthetic clinics.
- Replace the generic current look with a distinctive premium product-led UI.
- Preserve all routes, form fields, form payloads, submission logic, links, and API calls.
- Add tasteful motion and visual depth through CSS, with `prefers-reduced-motion` support.
- Use the best available visual approach without adding unnecessary dependencies or third-party assets.
- Keep content minimal: enough to understand the product, qualify interest, and apply for a pilot.

## Non-Goals

- No changes to API behavior.
- No changes to lead capture data shape.
- No changes to internal onboarding behavior.
- No new authentication, analytics, billing, CMS, or dashboard functionality.
- No dependency-heavy animation stack unless CSS cannot achieve the required result.

## Design Direction

Direction: **Operador premium en movimiento**.

Momentum should not look like another dark SaaS template or a generic chatbot landing. It should look like a focused commercial operator: a conversation comes in, intent is understood, real availability is offered, and the appointment is confirmed.

The experience should use:

- a dark, high-contrast premium base;
- restrained warm and electric accents instead of a one-note mint palette;
- sharp typography and compact Spanish copy;
- product mockups that show chat, qualification, calendar, and confirmation;
- CSS-only motion where it reinforces the flow;
- accessible reduced-motion fallbacks.

## Asset And Library Decision

I considered using existing animation/mockup libraries such as Motion for React, but the public UI can achieve the desired effect with semantic markup, existing `lucide-react` icons, and CSS keyframes. Avoiding a new animation dependency keeps the landing lighter and avoids turning a static public page into client-side animation code.

The mockup should be custom-coded rather than imported from a generic chat mockup. Momentum's strongest differentiator is the specific operational sequence from WhatsApp to real calendar booking, so a bespoke visual is more valuable than a stock chat component.

External design references used only as directional input:

- modern SaaS landing direction: product-led storytelling and purposeful motion;
- Material Design motion principles: motion should communicate relationships and outcomes;
- `prefers-reduced-motion`: respect user motion preferences.

## Landing Page

### Hero

Hero message:

> La recepción IA que convierte WhatsApp en turnos confirmados.

Supporting copy:

> Momentum responde consultas, entiende intención, ofrece horarios reales y confirma turnos para clínicas estéticas que no quieren perder pacientes por demora.

Primary CTA remains `/lead`, translated to:

> Activar piloto

Secondary CTA remains the in-page flow anchor:

> Ver cómo funciona

The hero visual becomes a product scene, not a static card. It should combine:

- a phone-like WhatsApp conversation;
- an intent/qualification rail;
- a calendar confirmation card;
- subtle pulses and sequencing that imply the operator is working.

### Problem

Keep the problem minimal:

- patients compare clinics in WhatsApp;
- reception loses speed and consistency;
- warm conversations and freed slots are underused.

### Flow

Show four steps with Spanish copy:

1. El paciente escribe.
2. Momentum entiende intención.
3. Ofrece agenda real.
4. Confirma y sostiene el seguimiento.

### Automation Surface

Keep the current capability list but translate and polish it:

- Reservas
- Reprogramaciones
- Cancelaciones
- Recordatorios
- Reactivación
- Huecos liberados
- Derivación humana

### Trust And Control

Emphasize that Momentum is controlled:

- agenda real como fuente de verdad;
- respuestas aprobadas;
- derivación humana cuando corresponde.

### Final CTA

Final message:

> Empezá con un piloto asistido.

Set expectation that the clinic is reviewed before activation.

## Lead Page

The lead page keeps the exact same form state, fields, validation attributes, submit handler, API function, and success/error behavior.

Changes:

- Spanish heading and field labels;
- more premium layout;
- compact trust pills;
- clearer expectation that this is a reviewed pilot, not instant activation;
- Spanish submit states.

## Motion Requirements

- CSS-only animations for the landing mockup and microinteractions.
- No motion that is required to understand the content.
- Add `@media (prefers-reduced-motion: reduce)` to disable or flatten non-essential animation and smooth scrolling.
- Button/field hover states may use short transitions.

## Testing And Verification

Add a static UI test that fails before implementation and verifies:

- landing hero Spanish copy exists;
- no public landing English positioning copy remains;
- lead page Spanish application copy exists;
- CSS contains the new mockup/motion hooks;
- CSS includes a reduced-motion media query.

After implementation:

- run the UI test;
- run web typecheck;
- run web build;
- start the web dev server;
- verify `/` and `/lead` in browser at desktop and mobile sizes;
- confirm there are no console errors and form controls still render.

## Source Notes

- Motion for React documentation describes a production animation library and reduced-motion support, but this redesign does not require a new runtime dependency: https://motion.dev/react and https://motion.dev/docs/react-use-reduced-motion
- Material Design motion guidance frames motion as a way to communicate relationships, action availability, and outcomes: https://m2.material.io/design/motion/understanding-motion.html
- MDN documents `prefers-reduced-motion` as the browser signal for reduced animation preferences: https://developer.mozilla.org/en-US/docs/Web/CSS/%40media/prefers-reduced-motion
