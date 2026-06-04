# Momentum Web Design ZIP Refresh Plan

## Task 1 - Port The Supplied Landing

- Files:
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/app/momentum-scene.tsx`
  - `apps/web/src/app/globals.css`
  - `apps/web/src/app/layout.tsx`
- Change:
  - Replace the current public landing with the supplied ZIP layout, copy, palette, typography, CTA treatment, feature strip, and animated scene.
  - Add Satoshi and JetBrains Mono font links in the root layout.
- Expected result:
  - `/` renders the Momentum ZIP design with the left copy, right animation, and feature strip.

## Task 2 - Adapt Existing Paths To The Same Visual System

- Files:
  - `apps/web/src/app/lead/page.tsx`
  - `apps/web/src/app/globals.css`
  - `apps/web/src/app/internal/onboarding/page.tsx`
  - `apps/web/src/app/internal/onboarding/clinics/[clinicId]/page.tsx`
  - `apps/web/src/app/internal/onboarding/clinics/[clinicId]/activation/page.tsx`
  - `apps/web/src/app/internal/onboarding/clinics/[clinicId]/test/page.tsx`
- Change:
  - Keep existing behavior, form names, API calls, admin-token gating, Google Calendar controls, and test-mode chat flow.
  - Restyle `/lead` and internal panels with the same warm background, white panels, compact buttons, green accent, and restrained borders.
- Expected result:
  - Non-landing paths feel like the same product without changing backend behavior.

## Task 3 - Update UI Contract Tests

- File:
  - `apps/web/tests/public-ui.test.mjs`
- Change:
  - Replace assertions for the old WhatsApp Web landing with assertions for the ZIP landing, scene component, localized metadata, and shared light visual tokens.
- Expected result:
  - The public UI test protects the new design contract and no longer references the removed dark/glass UI.

## Task 4 - Local Verification

- Commands:
  - `npm --workspace apps/web run test:ui`
  - `npm --workspace apps/web run typecheck`
  - `npm --workspace apps/web run build`
- Rendered QA:
  - Start `npm --workspace apps/web run dev`.
  - Verify `/` desktop and mobile against the ZIP reference.
  - Verify `/lead` and one internal path render with the adapted system and no framework overlay.
- Expected result:
  - Tests, typecheck, build, and rendered smoke checks pass.
