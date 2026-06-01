# Cluely-Inspired Public UI Redesign Design

Date: 2026-06-01
Status: User-approved override: implement without further questions

## Summary

The current Momentum public UI still reads as a basic SaaS page with generic chat mockups. Redesign `/` and `/lead` again, using `https://cluely.com/` as directional inspiration: editorial hero, cinematic product surface, high craft, minimal copy, and clear product positioning.

This is an adaptation, not a literal clone. Momentum keeps its own Spanish positioning for aesthetic clinics and its own WhatsApp-to-calendar workflow.

## Goals

- Make the first viewport feel premium and distinctive, not card-heavy or template-like.
- Use Spanish copy that is shorter, sharper, and more brand-led.
- Replace the phone/card mockups with a larger desktop-style operating surface that shows WhatsApp intake, AI triage, calendar booking, and human control.
- Keep all behavior unchanged: routes, links, form fields, values, submit handler, API call, validation attributes, and lead payload shape.
- Use CSS motion and polished microinteractions without adding runtime animation dependencies.
- Preserve reduced-motion support.

## Visual Direction

Momentum becomes a product-led operator interface:

- centered editorial hero with a short headline;
- dark cinematic first section with a large product mockup below the CTA;
- alternating light operating sections for contrast and sophistication;
- fewer cards, more structured bands, rails, timelines, and product surfaces;
- command-palette and desktop-window cues adapted to clinic operations;
- no stock chat screenshots, no generic bubbles as the main artifact.

## Required Public Copy

- Headline: `Agenda llena. Inbox liviano.`
- Product description: `Momentum es el operador IA que responde WhatsApp, detecta intención y reserva sobre tu agenda real.`
- Primary CTA: `Activar piloto`
- Secondary CTA: `Ver el flujo`
- Positioning line: `No es otro chatbot. Es una capa operativa para convertir demanda en turnos.`
- Final CTA: `Convertí WhatsApp en una recepción de alto rendimiento.`

## Lead Page

The lead page should feel like the continuation of the product surface, not a plain form. Keep the same form behavior and payload, but present it as a reviewed pilot request with strong Spanish copy and a compact operational preview.

## Verification

Add/update static UI tests to fail before implementation and verify:

- new Spanish headline and positioning exist;
- Cluely-inspired product hooks exist (`product-theater`, `momentum-os`, `command-deck`);
- old hero copy and old phone mockup hooks are gone from the landing;
- lead form behavior-sensitive code and field names remain;
- CSS includes new motion keyframes and reduced-motion fallback.
