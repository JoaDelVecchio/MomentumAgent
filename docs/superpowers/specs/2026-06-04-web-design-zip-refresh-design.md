# Momentum Web Design ZIP Refresh

## Source Of Truth

The user supplied `C:/Users/joaqu/Downloads/MOMENTUM.zip` as the approved visual design.

The ZIP contains:

- `Momentum Landing.html`
- `app.jsx`
- `scene.jsx`
- `styles.css`

The landing must match this design direction: warm near-white background, compact header, left hero copy, right animated WhatsApp/calendar scene, black primary CTA, green accent, and a bottom feature strip.

## Product Goal

Make the public landing look exactly like the supplied design and adapt the rest of the web paths to the same visual language.

## Design System

- Background: warm near-white `oklch(0.986 0.004 95)`.
- Surfaces: white panels with subtle warm borders.
- Accent: green `oklch(0.64 0.118 158)`.
- Text: warm dark ink, softer gray-brown secondary text.
- Typography: Satoshi for UI/content and JetBrains Mono for small operational labels.
- Buttons: compact black filled primary buttons and quiet bordered secondary controls.
- Radius: restrained, mostly 11-20px depending on element scale.
- Motion: subtle message/slot animation, reduced under `prefers-reduced-motion`.

## Scope

Implement:

- public landing at `/`;
- lead form at `/lead`;
- internal onboarding index;
- clinic setup;
- activation gate;
- test mode chat.

Preserve:

- existing form names and API calls;
- admin token behavior;
- onboarding/test/activation functionality;
- current Next.js app router structure.

## Non-Goals

- New backend behavior.
- New conversion copy beyond the supplied landing.
- A new onboarding information architecture.
- Deploying before local visual and type/test checks pass.

