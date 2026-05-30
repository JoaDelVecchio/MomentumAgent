# Public Landing + Clinic Onboarding & Activation Design

Date: 2026-05-30
Status: Approved for implementation planning

## Summary

Momentum needs a premium public presence and a real assisted onboarding flow for clinics. The landing should make Momentum feel modern, ambitious, and differentiated from traditional clinic software. The onboarding and activation system should let the team configure and launch real clinics whether they came from the landing, a demo call, a referral, or an in-person sale.

This is not a customer dashboard or a self-serve billing product. It is the commercial and operational bridge between selling Momentum and safely activating a clinic in production.

## Goals

- Ship a premium public landing page that positions Momentum as a WhatsApp-native AI receptionist and appointment system for aesthetic clinics.
- Capture qualified clinic leads without forcing full self-serve setup too early.
- Add a private onboarding and activation workflow for the Momentum team.
- Store clinic setup data in the real operational database instead of hardcoded demo seed files.
- Support in-person sales by letting the team create and configure a clinic directly.
- Gate production WhatsApp behavior behind explicit readiness, payment, and activation states.
- Keep one activation path regardless of acquisition source.

## Non-Goals

- No automated checkout or subscription billing.
- No full customer-facing dashboard.
- No self-serve WhatsApp production activation.
- No analytics suite beyond setup status and activation readiness.
- No blog, SEO content engine, or marketing CMS.
- No multi-location setup in this first version.
- No internal staff WhatsApp agent.

## Market Positioning

Traditional clinic software usually sells operational administration: calendars, forms, records, payments, or patient management. Momentum should sell growth and responsiveness:

- more WhatsApp conversations converted into booked appointments;
- fewer lost leads from slow replies;
- less front-desk load;
- reactivation of warm demand;
- real calendar-backed booking;
- premium assisted implementation.

The tone should be aspirational and commercially direct. Momentum should not sound like legacy medical software or a generic chatbot.

Core message:

> The AI receptionist for WhatsApp that turns clinic conversations into confirmed appointments.

Supporting message:

> Momentum replies, books, reschedules, reminds, and reactivates patients automatically, connected to the clinic's real calendar.

## Public Landing

### Audience

Initial audience:

- aesthetic clinics;
- dermatology aesthetics;
- med spas or similar appointment-heavy clinics;
- owner-operators, managers, reception leads, and doctors involved in growth.

### Tone

- Young, modern, premium, confident.
- Direct and revenue-oriented.
- Clear that Momentum is specialized, not a generic chatbot.
- Aspirational but accurate: assisted activation, not instant self-serve production.

Avoid:

- medical-record system language;
- corporate-heavy SaaS copy;
- vague AI claims;
- promises that production can be activated without setup, permissions, or review.

### Suggested Copy Direction

Hero headline:

> Turn WhatsApp into your clinic's appointment engine.

Hero subcopy:

> Momentum is an AI receptionist for aesthetic clinics. It answers leads, explains approved services, books real calendar slots, reschedules, cancels, reminds, and reactivates warm patients automatically.

CTA examples:

- "Activate a pilot"
- "Book a demo"
- "See Momentum in action"

Value copy:

- "Every unanswered WhatsApp is demand cooling down."
- "Your calendar stays the source of truth."
- "Reception gets backup that works after hours."
- "Old warm leads get followed up without manual chasing."
- "Freed slots can be offered to patients who already wanted them."

### Landing Sections

1. Hero
   - strong headline;
   - WhatsApp conversation and calendar visual;
   - primary CTA: "Activate a pilot";
   - secondary CTA: "See demo".

2. Problem
   - WhatsApp demand is messy, fast, and easy to lose;
   - reception forgets, delays, or cannot answer after hours;
   - manual follow-up leaves revenue on the table.

3. Product
   - AI receptionist specialized for aesthetic clinics;
   - not a generic bot;
   - connected to the real agenda.

4. Conversion Flow
   - patient writes on WhatsApp;
   - Momentum understands intent;
   - explains service/preparation/pricing;
   - offers real availability;
   - confirms appointment;
   - sends reminders and follow-ups.

5. Automation Surface
   - booking;
   - rescheduling;
   - cancellations;
   - reminders;
   - warm-lead reactivation;
   - freed-slot offers;
   - human handoff.

6. Trust And Control
   - calendar remains source of truth;
   - opt-out respected;
   - handoff pause;
   - audit logs;
   - approved WhatsApp templates for outbound;
   - assisted activation.

7. Lead Capture
   - short form;
   - no full setup burden on the public page.

8. Final CTA
   - "Start with an assisted pilot."

### Visual Direction

The landing should feel like a modern AI product, not a healthcare admin portal:

- high-contrast premium palette;
- strong typography;
- polished WhatsApp/calendar product visuals;
- motion or progressive reveal where useful;
- dense enough to feel credible, not a vague hero page;
- no beige medical-template aesthetic;
- no traditional stock photos of doctors smiling at laptops.

Visual assets should show the actual product idea: a WhatsApp conversation becoming a booked calendar appointment.

## Lead Capture

The public form should be short and qualification-oriented:

- contact name;
- clinic name;
- WhatsApp or phone;
- city/country;
- number of professionals;
- current calendar/software;
- approximate WhatsApp inquiry volume;
- main pain: missed leads, reception load, reactivation, no-shows, rescheduling, other.

Submitting the form should create a lead record with:

- source: `landing`;
- status: `lead`;
- submitted data;
- timestamp.

The success message should set expectation:

> We will review your clinic and contact you to activate an assisted pilot.

Do not imply that the agent is already live.

## Private Onboarding & Activation

### Purpose

The private onboarding tool lets Momentum configure clinics for real operation without hardcoding data or building a full dashboard.

It must support two acquisition paths:

- landing lead converted into a clinic;
- direct clinic creation for in-person sales, referrals, or outbound sales.

Both paths should converge into the same setup and activation workflow.

### Access

MVP access can be protected by an internal setup token or simple internal auth. It must not be publicly discoverable or editable by clinics without review.

### Clinic States

Use explicit states:

- `lead`: public or manually created prospect.
- `setup`: clinic exists but setup is incomplete.
- `ready`: required data and integrations are present; not live yet.
- `active`: production WhatsApp behavior is allowed.
- `paused`: production is temporarily disabled.

Payment should be tracked manually at first:

- `paymentStatus`: `unpaid`, `paid`, `trial`, `waived`.

Production WhatsApp automation requires:

- clinic state `active`;
- payment status compatible with launch;
- valid clinic profile;
- calendar mapping present;
- WhatsApp/Kapso runtime configured;
- activation checklist completed.

### Onboarding Data

Required data:

- clinic name;
- primary contact;
- source;
- services:
  - name;
  - duration;
  - approved price text;
  - preparation;
  - restrictions;
  - professionals who can perform it;
- professionals:
  - name;
  - calendar mapping;
  - working hours;
- appointment rules:
  - minimum booking notice;
  - cancellation/reschedule notice;
  - buffer;
- required patient fields;
- operational FAQs:
  - payment methods;
  - insurance/obra social answer;
  - address;
  - parking/access if relevant;
  - general policy notes;
- WhatsApp/Kapso configuration status;
- Google Calendar connection status.

Not required for the first version:

- multiple locations;
- advanced brand tone editor;
- custom template copy editor;
- staff roles/permissions;
- complex medical software integrations.

### Wizard Steps

1. Create Or Select Clinic
   - create from lead;
   - create manually;
   - choose source.

2. Clinic Basics
   - clinic name;
   - contact;
   - country/city;
   - payment status.

3. Services
   - add/edit services;
   - duration, price, preparation, restrictions;
   - mark all services as directly reservable for MVP.

4. Professionals
   - add/edit professionals;
   - working hours;
   - services they perform.

5. Calendar
   - connect Google Calendar;
   - map each professional to a calendar;
   - show missing mappings.

6. Rules And FAQs
   - appointment rules;
   - required fields;
   - FAQ answers approved by clinic.

7. Test Mode
   - run simulated conversations against the clinic config;
   - test booking, rescheduling, cancellation, questions;
   - no production WhatsApp send required.

8. Activation Checklist
   - required data complete;
   - calendar connected;
   - WhatsApp configured;
   - payment status accepted;
   - test conversation passed;
   - manual activation button.

### Test Mode

Test mode should let the Momentum team verify behavior before production:

- simulate inbound WhatsApp text;
- inspect the agent response;
- verify availability is read from the configured calendar;
- verify booking creates the correct appointment when explicitly tested;
- keep production WhatsApp disabled until active.

Test mode can reuse existing simulation API behavior, but it must be scoped to the selected clinic.

## Activation Gate

The existing real WhatsApp webhook path must not process production clinic traffic for inactive clinics.

If a clinic is not active:

- do not book real appointments from production WhatsApp;
- do not send outbound automations;
- record or return a safe inactive-clinic result;
- avoid confusing patient-facing messages unless a deliberate demo behavior is configured.

For internal simulation/test mode:

- allow testing while state is `setup` or `ready`;
- clearly mark it as non-production.

## Data Model Direction

Add durable setup entities rather than relying on hardcoded seed data:

- `ClinicLead`
- clinic setup fields/state on `Clinic`
- payment status on `Clinic`
- activation checklist metadata or computed readiness
- optional FAQ/knowledge records if existing clinic profile shape cannot hold them cleanly

The current `ClinicProfile` remains the operational contract for scheduling and conversation workflows. Onboarding should save data in a way that can build or persist that profile consistently.

## Error Handling

- Invalid setup data should show field-level validation errors.
- Missing calendar mapping should block `ready`.
- Missing required services/professionals should block activation.
- Calendar connection failure should keep clinic in setup and show reconnect guidance.
- Production activation should fail closed if any required check is missing.
- Duplicate lead submissions should not create confusing duplicate active clinics; MVP can allow duplicates if clearly visible, but conversion to clinic should require explicit selection.

## Security And Privacy

- Private onboarding routes require an internal token/auth.
- Do not expose API keys, OAuth tokens, or provider secrets in UI.
- Store only operational data needed for setup and agent behavior.
- Treat WhatsApp phone numbers as patient/contact data.
- Keep audit logs for activation changes.
- Never send outbound messages for inactive clinics.

## Metrics

Landing metrics:

- lead submissions;
- CTA clicks;
- source;
- clinic profile type;
- inquiry volume estimate.

Activation metrics:

- lead to setup;
- setup to ready;
- ready to active;
- time to activation;
- failed checklist item counts.

Product metrics after activation already live in operational records:

- appointments booked;
- reminders sent;
- reactivations;
- freed-slot offers;
- blocked/failed outbound sends.

## Implementation Shape

The implementation should introduce a compact web frontend because the scope now includes a premium public landing, rich lead capture, and a private multi-step setup tool.

Use a separate Next.js App Router web app under `apps/web` and keep the current Fastify service as the operational API/runtime. This creates a clean boundary:

- `apps/web`: public landing, lead form, private onboarding UI, activation workflow.
- existing `src/`: operational backend, scheduling, WhatsApp, Google Calendar, outbound automation, Prisma repositories.

The web app should call backend/internal APIs rather than duplicating operational logic.

The first implementation can keep both apps in one repo with npm workspaces if needed. Do not split into separate repositories.

Frontend routes:

- public landing routes;
- lead form route;
- private onboarding routes;
- test-mode UI;
- activation checklist UI.

Backend/API additions:

- lead creation endpoint;
- internal lead listing/conversion endpoints;
- clinic setup read/write endpoints;
- activation state/payment status endpoints;
- test-mode endpoint scoped to selected clinic;
- production activation gate in WhatsApp and outbound runtime paths.

Reuse existing simulation, Google OAuth, and WhatsApp runtime paths where possible.

## Acceptance Criteria

- A visitor can view a premium Momentum landing page and submit a qualified lead.
- A Momentum operator can create a clinic from a lead or manually.
- A Momentum operator can enter real clinic setup data without editing source code.
- The setup flow validates required services, professionals, rules, and calendar mappings.
- A Momentum operator can run a test conversation for a setup/ready clinic.
- A clinic cannot process production WhatsApp traffic or outbound automations until active.
- A Momentum operator can mark payment status manually and activate/pause a clinic.
- Existing booking, calendar, WhatsApp, outbound, Prisma, and test behavior remain compatible.

## Implementation Decisions

- Frontend stack: Next.js App Router in `apps/web`.
- Backend runtime: keep current Fastify operational API.
- Internal auth MVP: setup/admin token, not full user accounts.
- Lead model: separate `ClinicLead`; conversion creates or links a `Clinic`.
- Clinic state/payment status: persisted on `Clinic`.
- FAQs: first-class clinic knowledge records so the agent can answer operational questions without bloating service definitions.
- Google Calendar connection: onboarding UI links into the existing OAuth flow and then verifies connection/mapping status.
- WhatsApp setup: track configuration/readiness, but do not implement full self-serve WhatsApp onboarding in this block.

## Sources And Product Signals

The design follows a hybrid sales motion common in higher-touch clinic and patient-engagement tools: premium marketing page, demo/lead capture, assisted setup, and controlled activation. Self-serve checkout can come later once pricing, implementation effort, and support needs are validated.

Reference product signals reviewed:

- healthcare/patient engagement and scheduling platforms such as [NexHealth](https://www.nexhealth.com/pricing);
- med spa and aesthetic clinic platforms such as [Boulevard](https://www.joinblvd.com/);
- self-serve salon/spa SaaS tools such as [Fresha](https://www.fresha.com/pricing/) and [GlossGenius](https://glossgenius.com/pricing);
- WhatsApp Business Platform setup constraints around [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/) and [template messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/).
