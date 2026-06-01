# Cluely-Inspired Public UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Momentum's public landing and lead form into a premium Spanish product experience inspired by Cluely, without changing behavior.

**Architecture:** Keep the existing Next.js App Router pages and shared CSS. Modify static markup/copy, CSS classes, metadata if needed, and static UI contract tests only.

**Tech Stack:** Next.js 16, React 19, TypeScript, lucide-react, CSS animations, Node test runner.

---

### Task 1: Failing UI Contract

**Files:**
- Modify: `apps/web/tests/public-ui.test.mjs`

- [ ] Assert the new headline `Agenda llena. Inbox liviano.`.
- [ ] Assert product hooks `product-theater`, `momentum-os`, and `command-deck`.
- [ ] Assert old landing copy and old `mock-phone` hero hook are absent.
- [ ] Assert lead form behavior-sensitive fields and `submitClinicLead(form)` remain.
- [ ] Run `npm --workspace apps/web run test:ui` and confirm it fails before implementation.

### Task 2: Landing Redesign

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] Replace the current public landing markup with the new editorial hero, product theater, operating flow, automation band, control section, and final CTA.
- [ ] Preserve `/lead` and `#flow` links.
- [ ] Keep all copy Spanish and minimal.

### Task 3: Lead Redesign

**Files:**
- Modify: `apps/web/src/app/lead/page.tsx`

- [ ] Redesign the lead shell and side preview.
- [ ] Preserve `initialForm`, `painOptions` values, submit behavior, input names, validation attributes, and status behavior.

### Task 4: CSS System

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] Replace public/lead styling with the Cluely-inspired visual system.
- [ ] Keep internal onboarding styles functional.
- [ ] Add CSS-only motion for reveal, scan, booking confirmation, and command deck.
- [ ] Preserve `@media (prefers-reduced-motion: reduce)`.

### Task 5: Verification And Push

**Commands:**
- `npm --workspace apps/web run test:ui`
- `npm run typecheck:web`
- `npm run build:web`
- `npm test`

- [ ] Start the local web server and verify `/` and `/lead` in browser.
- [ ] Commit the scoped UI changes.
- [ ] Push `main` so Vercel production updates.
