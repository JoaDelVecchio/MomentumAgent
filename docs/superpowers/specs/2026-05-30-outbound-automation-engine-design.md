# Outbound Automation Engine Design

Date: 2026-05-30
Status: Draft for user review

## Summary

Momentum already has the core appointment workflow, WhatsApp/Kapso integration, Google Calendar integration, Prisma persistence, and safe conversational understanding.

This block turns the outbound MVP promises into an operational service:
- appointment reminders;
- abandoned-lead reactivation;
- freed-slot offers;
- opt-out and quiet-hour protection;
- idempotent WhatsApp template delivery;
- auditability for every automated outbound action.

The goal is not to build a marketing campaign tool. The goal is to make Momentum act like an intelligent appointment system that protects the clinic's WhatsApp quality while recovering real appointment revenue.

## Goal

Automatically send the right WhatsApp message at the right time when Momentum has a high-confidence operational reason:
- remind a patient about a confirmed appointment;
- follow up with a warm lead who previously wrote and showed booking intent;
- offer a newly freed slot to a patient who already expressed matching interest.

## Non-Goals

This block does not include:
- customer dashboard or campaign builder;
- clinic-managed template editing;
- cold outreach or imported contact lists;
- payments, deposits, or checkout links;
- full CRM segmentation;
- AI-generated outbound campaigns;
- Outlook-specific scheduler changes;
- a new staff/internal WhatsApp agent.

## Product Decisions

- Use deterministic outbound workflows. AI may help conversation understanding elsewhere, but outbound eligibility, timing, template choice, and deduplication are application code decisions.
- Use approved WhatsApp templates for business-initiated outbound automation. Template copy, categories, and compliance handling are Momentum-owned operational setup, not clinic onboarding questions.
- Use free-form WhatsApp text only when responding inside an active patient conversation. Scheduled reminders, reactivation, and freed-slot offers should use templates by default.
- Respect opt-out before every outbound send.
- Do not send cold messages. Reactivation is allowed only for patients who previously contacted the clinic's WhatsApp and have not opted out.
- Avoid noisy reactivation. MVP reactivation should target warm operational signals first, such as abandoned booking state or saved slot interest, not every old chat.
- Use clinic timezone and quiet hours for all outbound timing. Default quiet hours are 20:00 to 09:00 local clinic time.
- Keep same-chat continuity. If the patient replies to a reminder, reactivation, or freed-slot offer, the existing inbound conversation workflow continues in the same WhatsApp chat.
- Do not guarantee a freed slot is held unless Momentum actually books it. MVP freed-slot copy should say the slot is available now and will be confirmed only after the patient replies and the calendar still has it.

## Required Capabilities

### Reminder Automation

Momentum should send appointment reminders for scheduled appointments:
- about 72 hours before when applicable;
- about 24 hours before;
- same-day only for higher-risk appointments, such as first visit, unconfirmed appointment, long duration, high value, or product-configured risk.

Default MVP behavior:
- 72h and 24h reminders are standard.
- Same-day reminder is opt-in by product rule, not sent to every appointment.
- Each appointment/reminder kind can be sent at most once.
- Before sending, Momentum verifies the appointment is still scheduled and, when calendar data is available, that the calendar event is not cancelled.
- If the send time falls inside quiet hours, send at the nearest allowed time that still makes sense before the appointment.

### Reactivation Automation

Momentum should reactivate only warm leads:
- the patient previously wrote to the clinic WhatsApp;
- the patient did not opt out;
- the conversation is not paused for human handoff;
- there is no future scheduled appointment that makes the message irrelevant;
- there is a clear previous booking or interest signal.

Default cadence:
- one follow-up about 24 hours after abandoned booking intent;
- one final follow-up about 7 days later if there was no response;
- no indefinite repeated attempts.

MVP should not reactivate generic old conversations that have no stored booking/interest signal. That keeps noise low and protects account quality.

### Freed-Slot Automation

When a cancellation or reschedule creates an available slot, Momentum should:
- derive the freed slot from the old appointment time/professional;
- find active patient interests compatible with service, professional, and preferred window;
- rank the best match first;
- send at most one offer per slot in the MVP;
- store that the slot was offered so the same patient is not spammed repeatedly;
- re-check calendar availability before booking if the patient replies.

If the first patient does not answer, future product versions can cascade the offer to another matching patient. MVP should stay conservative.

## Architecture

Add an application-level `OutboundAutomationService` that coordinates:
- `OperationalRepository` for appointments, conversations, patients, interests, opt-outs, and outbound delivery state;
- `CalendarPort` for final appointment/event verification where needed;
- `WhatsAppProvider` through `OutboundTemplateService` for approved templates;
- `AuditLogPort` for traceability;
- existing policy helpers for reminder timing, reactivation cadence, and freed-slot matching.

The service should expose deterministic methods such as:
- `runDueReminders({ clinicId, now })`;
- `runDueReactivations({ clinicId, now })`;
- `handleFreedSlot({ clinicId, slot, serviceId, sourceAppointmentId, now })`.

These methods should be safe to run repeatedly. A future cron/worker can call them without creating duplicate messages.

## Persistence And Idempotency

Outbound delivery needs durable state. A process restart must not cause duplicate reminders or duplicate reactivation attempts.

The implementation should persist:
- outbound delivery key;
- clinic id;
- patient/contact target;
- automation type: reminder, reactivation, freed-slot;
- template name;
- status: claimed, sent, failed, blocked;
- provider message id when sent;
- timestamps;
- small metadata needed for debugging and dedupe.

Recommended dedupe keys:
- reminder: `reminder:<appointmentId>:<kind>`;
- reactivation: `reactivation:<conversationId>:<attemptNumber>`;
- freed slot: `freed-slot:<sourceAppointmentId>:<interestId>:<slotStart>`.

Claim delivery before sending. If the send fails, mark it failed and allow a controlled retry only where the product rule allows it. Never rerun workflow side effects just because WhatsApp delivery was retried.

## WhatsApp Templates

Template ownership:
- Momentum defines and manages the approved template names/copy.
- Clinics should not need to configure templates during onboarding.
- Operational setup may still require templates to be approved in the connected WhatsApp Business Account or BSP environment.

Template categories:
- appointment reminders should use utility-style templates;
- reactivation may require marketing-style templates depending on current WhatsApp policy and provider classification;
- freed-slot offers may be utility when tied to an explicit saved request, otherwise should be treated conservatively.

Template examples are implementation details, but the message should always make the next action easy:
- confirm;
- reschedule;
- cancel;
- reply if interested.

## Data Flow

### Reminder

1. Scheduler calls `runDueReminders`.
2. Service lists scheduled appointments in reminder windows.
3. Service skips opted-out patients, paused conversations, already-sent reminder kinds, cancelled appointments, and quiet-hour violations.
4. Service claims the outbound delivery key.
5. Service sends the approved WhatsApp template.
6. Service records sent/blocked/failed status and audit event.

### Reactivation

1. Scheduler calls `runDueReactivations`.
2. Service finds warm abandoned booking or interest candidates.
3. Service applies opt-out, handoff pause, prior appointment, attempt count, and cadence rules.
4. Service claims the reactivation attempt.
5. Service sends the approved WhatsApp template.
6. Patient replies, and normal inbound workflow resumes.

### Freed Slot

1. Scheduling workflow cancels or reschedules an appointment.
2. The old appointment slot is passed to `handleFreedSlot`.
3. Service matches the slot against active interests.
4. Service claims one freed-slot outbound delivery.
5. Service sends the approved WhatsApp template to the best match.
6. If the patient replies, booking still goes through the normal calendar availability and confirmation workflow.

## Error Handling

- If WhatsApp send fails, record a failed delivery and audit event.
- If a duplicate worker tries the same outbound key, only one claim should send.
- If the appointment or calendar event is cancelled before a reminder sends, skip and audit.
- If the patient opted out after candidate selection but before send, block and audit.
- If the conversation is paused for handoff, do not send automation.
- If the current time is inside quiet hours, skip until the next allowed send window.
- If no template is configured for an automation type, fail closed and audit instead of sending free-form text.

## Safety And Compliance Rules

- Stop all reactivation and freed-slot outbound messages if the patient opts out.
- Continue sending appointment-critical reminders only if product/legal policy allows it; MVP should block all outbound to opted-out contacts for simplicity.
- Never send outbound automation to purchased lists, imported cold contacts, or contacts without prior WhatsApp interaction.
- Avoid repeated messages: use hard attempt limits and durable dedupe.
- Keep audit metadata useful but minimal. Do not store secrets, OAuth tokens, or raw provider credentials.

## Metrics

Track internally through audit/outbound delivery records:
- reminders sent, blocked, failed;
- reactivation attempts sent;
- freed-slot offers sent;
- replies after outbound;
- appointments booked after reactivation;
- freed slots filled;
- opt-out rate after outbound;
- WhatsApp provider failures;
- duplicate sends prevented.

Primary business metric:
- confirmed appointments generated or protected by outbound automation.

## Testing Requirements

Tests must cover:
- reminder windows for 72h, 24h, and same-day;
- no duplicate reminder after restart or concurrent runs;
- no send to opted-out contacts;
- no send while conversation is paused for human handoff;
- quiet-hour behavior;
- skipped reminder for cancelled appointment/calendar event;
- reactivation only for prior warm leads with no future appointment;
- reactivation cadence and attempt limit;
- freed-slot matching, ranking, and one-offer idempotency;
- provider send failure records failed delivery and audit;
- full suite, typecheck, and Prisma validation pass.

## Acceptance Criteria

- Running outbound automation repeatedly does not send duplicates.
- Appointment reminders can be sent through approved WhatsApp templates.
- Warm abandoned leads can be reactivated without messaging cold contacts.
- A freed appointment slot can be offered to the best matching interested patient.
- Opt-out, handoff pause, quiet hours, and missing-template cases block outbound sends.
- All outbound actions are auditable.
- Existing inbound booking, rescheduling, cancellation, Kapso, Google Calendar, Prisma, and AI interpreter tests remain compatible.

## Sources

- Momentum MVP PRD: `docs/superpowers/specs/2026-05-29-momentum-mvp-prd-design.md`
- WhatsApp Business Messaging Policy: https://business.whatsapp.com/policy/
- WhatsApp Business Platform message templates: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
- WhatsApp Business Platform pricing/categories: https://developers.facebook.com/docs/whatsapp/pricing
