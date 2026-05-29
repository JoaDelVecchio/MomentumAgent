# Momentum MVP PRD

Date: 2026-05-29
Status: Draft for user review

## Summary

Momentum is a WhatsApp-first appointment agent for aesthetic clinics in Argentina. It automates the full appointment lifecycle through the clinic's existing WhatsApp and calendars: answer, qualify, schedule, reschedule, cancel, remind, reactivate, fill freed slots, and hand off to a human when needed.

Momentum is not a generic chatbot and not a new clinic dashboard. It is an intelligent appointment layer that uses the clinic's current calendar as the source of truth.

## Product Principle

Momentum should maximize confirmed appointments and calendar occupancy with minimal clinic setup.

The agent uses AI to understand and converse, but calendar actions must be executed through controlled workflows and deterministic calendar tools. The agent must not diagnose, prescribe, or make clinical decisions.

## Target Customer

Initial customer: aesthetic clinics / aesthetic dermatology clinics in Argentina.

Initial deployment assumptions:
- One clinic location.
- Multiple professionals.
- Existing WhatsApp number.
- Existing Google Calendar or Outlook calendars.
- No customer-facing dashboard in the MVP.

## Primary User

Patient or lead who writes to the clinic's WhatsApp.

## MVP Goals

- Convert WhatsApp conversations into confirmed appointments.
- Reduce manual reception work around appointments.
- Recover abandoned conversations and previous leads.
- Fill newly available slots when appointments are cancelled or moved.
- Keep the clinic operating in its existing WhatsApp and calendar tools.
- Escalate safely to a human in the same chat when needed.

## Non-Goals

The MVP does not include:
- Customer dashboard.
- Mobile app.
- Payments or deposits.
- Clinical records.
- Medical diagnosis.
- Full CRM.
- Native visual calendar.
- Internal staff agent.
- Multiple clinic locations.
- Deep integrations with medical practice management systems.

## Core Capabilities

Momentum must:
- Receive and respond to WhatsApp messages.
- Understand intent: service question, price question, booking, rescheduling, cancellation, clinical/sensitive question, human handoff.
- Answer approved questions about services, price/range, duration, preparation, and basic restrictions.
- Book appointments directly when intent is clear.
- Reschedule appointments.
- Cancel appointments.
- Query real availability from connected calendars.
- Support multiple professionals.
- Create/update/cancel events in the assigned professional's calendar.
- Send booking confirmation.
- Send appointment reminders.
- Reactivate people who previously wrote to the clinic.
- Track interested patients when no ideal slot is available.
- Offer newly freed slots to matching interested patients.
- Pause the bot and hand off to a human in the same WhatsApp chat.
- Keep an internal audit trail of important actions.
- Respect opt-out / do-not-contact rules.

## Calendar Model

The calendar remains the source of truth.

Recommended MVP model:
- One calendar per professional.
- Each service maps to one or more professionals who can perform it.
- Momentum queries availability only for compatible professionals.
- If the patient requests a specific professional, Momentum filters by that professional.
- If multiple professionals are available, Momentum can offer the earliest/best options.
- The confirmed appointment is created in the assigned professional's calendar.

Rooms, devices, cabins, and other resources are out of scope unless a pilot clinic requires them.

## Company Onboarding

Onboarding must be short and focused. The clinic should only provide information required for the agent to operate.

Required onboarding data:
- Connect WhatsApp.
- Connect Google Calendar or Outlook.
- List reservable services.
- For each service: duration, price/range, preparation, and important restrictions.
- For each service: professionals who can perform it.
- For each professional: connected calendar.
- Basic appointment rules: minimum notice, cancellation/rescheduling policy, buffers if needed.
- Minimum patient data required to confirm an appointment.

Default patient data requirement:
- Name and surname.
- WhatsApp number is inferred from the conversation.
- Service, time, and professional are known from the booking flow.

Optional clinic knowledge:
- Whether the clinic accepts insurance/prepaid plans or is private only.
- Payment methods if patients ask.
- Common administrative answers.

Momentum handles internally:
- WhatsApp templates and outbound message compliance.
- Reactivation cadence.
- Reminder cadence.
- Human handoff logic.
- Base agent behavior.
- Audit logging.
- Opt-out handling.

## Booking Flow

1. Patient writes to the clinic on WhatsApp.
2. Momentum understands whether the patient is asking for information or trying to book.
3. If needed, Momentum answers brief questions about service, price/range, duration, preparation, or basic restrictions.
4. When booking intent is clear, Momentum identifies the service and any relevant preference, such as professional or time window.
5. Momentum queries availability from compatible professional calendars.
6. Momentum offers concrete available slots.
7. Patient chooses one slot.
8. Momentum asks only for minimum data required to confirm, defaulting to name and surname.
9. Momentum creates the calendar event.
10. Momentum confirms the appointment on WhatsApp.

Rule: Momentum should not ask for administrative data too early. It should only ask for required patient data once there is clear booking intent and a concrete appointment option.

## Rescheduling Flow

1. Patient asks to move an appointment.
2. Momentum identifies the existing appointment from conversation history and calendar data.
3. Momentum confirms which appointment should be moved if there is ambiguity.
4. Momentum queries available replacement slots.
5. Patient chooses a new slot.
6. Momentum updates the calendar event.
7. Momentum confirms the change on WhatsApp.

## Cancellation Flow

1. Patient asks to cancel.
2. Momentum identifies the appointment.
3. Momentum confirms cancellation intent if needed.
4. Momentum cancels or marks the event cancelled according to calendar capabilities.
5. Momentum confirms cancellation on WhatsApp.
6. Momentum may offer to reschedule when appropriate.
7. The freed slot can trigger the smart slot-fill flow.

## Reminder Flow

1. Momentum confirms immediately when the appointment is booked.
2. Momentum sends an automatic reminder around 72 hours before the appointment when applicable.
3. Momentum sends an automatic reminder around 24 hours before the appointment.
4. Momentum may send a same-day reminder when the appointment is unconfirmed, high value, first visit, long duration, or otherwise high risk.

Reminder messages should let the patient confirm, reschedule, or cancel.

## Reactivation Flow

Momentum reactivates only people who previously wrote to the clinic's WhatsApp.

Included:
- Leads who asked questions but never booked.
- Conversations abandoned before booking.
- Past patients who may reasonably return.

Excluded:
- Purchased lists.
- Imported cold contacts.
- People without prior WhatsApp interaction.
- Anyone who asked not to be contacted.

Flow:
1. Momentum detects a previous conversation with no confirmed appointment or a relevant past patient.
2. Momentum sends a relevant WhatsApp message under Momentum-managed compliance rules.
3. If the patient replies, Momentum resumes the normal conversation.
4. If the patient wants to book, Momentum enters the booking flow.
5. If the patient asks not to receive messages, Momentum marks them as do-not-contact.

## Smart Freed-Slot Flow

Momentum should act like an intelligent agenda agent, not only a booking form.

Use case: a patient wanted a specific time, professional, or earlier appointment, but no ideal slot was available.

Flow:
1. Momentum records the patient's interest: service, preferred professional if any, preferred days/times, and acceptable alternatives.
2. Momentum monitors calendar changes or evaluates changes after cancellations/reschedules.
3. When a matching slot opens, Momentum offers it to the best matching patient.
4. If the patient confirms, Momentum books or reschedules the appointment.
5. If the slot is already taken or the patient does not answer in time, Momentum continues searching or offers it to another matching patient.

This flow helps fill cancellations and increase calendar occupancy.

## Human Handoff Flow

Handoff should happen in the same WhatsApp chat and same clinic number.

Flow:
1. Momentum detects a case that should not be handled automatically.
2. Momentum tells the patient that reception will continue the conversation.
3. Momentum pauses the bot for that conversation.
4. A human responds from WhatsApp Business App or an equivalent approved inbox.
5. Momentum does not re-enter the conversation until it is explicitly reactivated or the handoff state expires according to product rules.

Handoff triggers:
- Clinical or medical advice request.
- Emergency, complication, or sensitive symptom.
- Angry or confused patient.
- Low confidence understanding.
- Unconfigured service or price.
- Calendar conflict.
- Patient explicitly asks for a human.
- Any situation where automatic action may create operational or medical risk.

## Opt-Out And Do-Not-Contact Rules

Momentum must avoid spam-like behavior and protect WhatsApp account quality.

Rules:
- Stop reactivation if the patient asks not to receive more messages.
- Recognize phrases such as "no me escriban mas", "baja", "stop", "no quiero", and similar.
- Do not reactivate contacts without prior WhatsApp interaction.
- Do not send repeated reactivation attempts indefinitely.
- Do not send outbound messages at inappropriate times.
- Keep opt-out state attached to the patient/contact.

## Audit Trail

Momentum must keep an internal record of important agent actions.

Examples:
- Message received.
- Intent detected.
- Slots offered.
- Patient selected slot.
- Calendar event created.
- Calendar event rescheduled.
- Calendar event cancelled.
- Reminder sent.
- Reactivation sent.
- Freed slot offered.
- Handoff triggered.
- Bot paused or reactivated.
- Patient marked do-not-contact.

This is not a customer dashboard. It is internal traceability for support, quality review, debugging, and accountability.

## Safety Rules

Momentum can:
- Explain approved service information.
- Share approved price/range, duration, preparation, and basic restrictions.
- Book a consultation or appointment.
- Reprogram or cancel appointments.
- Escalate to a human.

Momentum cannot:
- Diagnose.
- Recommend a treatment based on personal medical facts.
- Promise results.
- Decide clinical eligibility.
- Handle emergencies automatically.
- Invent prices, availability, policies, or medical information.

If the patient asks for personalized medical advice, Momentum should hand off to a human.

## Metrics

MVP success metrics:
- WhatsApp conversations handled.
- Booking intent detected.
- Appointments booked by Momentum.
- Reschedules completed by Momentum.
- Cancellations handled by Momentum.
- Previous leads reactivated.
- Freed slots filled.
- Time to first response.
- Human handoff rate.
- No-show rate where available.
- Opt-out/report rate.
- Calendar action failure rate.

Primary business metric:
- Confirmed appointments generated or recovered by Momentum.

## Research Notes

Relevant product and technology references:
- WhatsApp remains a dominant channel in Argentina/LatAm, making WhatsApp-first a reasonable initial wedge: https://datareportal.com/reports/digital-2025-argentina/
- WhatsApp Business Platform should be used for official WhatsApp automation, with attention to templates, quality, and policy compliance: https://business.whatsapp.com/policy/
- Same-chat human handoff is preferred. WhatsApp Business App and API coexistence may support this depending on provider/account eligibility: https://docs.360dialog.com/docs/waba-management/embedded-signup/whatsapp-coexistence
- Calendar availability should come from calendar APIs, not from model guesses: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Microsoft calendar availability can be handled through Microsoft Graph calendar APIs: https://learn.microsoft.com/en-us/graph/api/resources/calendar-overview
- AI should call controlled tools for real actions such as creating, updating, or cancelling events: https://platform.openai.com/docs/guides/function-calling

## Implementation Defaults For Planning

These defaults keep the PRD actionable while leaving vendor selection to the implementation plan.

WhatsApp:
- Momentum must use the official WhatsApp Business Platform through Meta Cloud API or a BSP that supports Cloud API-compatible messaging.
- Same-chat handoff is required. If WhatsApp Business App coexistence is available for the clinic number, staff should answer from the WhatsApp Business App after the bot pauses.
- If coexistence is unavailable for a pilot, the fallback is an approved shared inbox that still sends replies from the same clinic WhatsApp number.

Calendar:
- MVP product scope includes Google Calendar and Outlook.
- The implementation plan may sequence them, but MVP is not complete until both connector paths are supported or one is explicitly removed from scope by the user.

Handoff notification:
- The patient must remain in the same chat.
- The bot must pause the conversation before handoff.
- Staff notification can be handled by the WhatsApp Business App/shared inbox. A separate customer dashboard is not required.

Reactivation cadence:
- Momentum manages cadence internally.
- Default for abandoned booking conversations: one follow-up after about 24 hours and one final follow-up after about 7 days if there is no response.
- Further reactivation requires a new valid trigger, such as a later availability match, previous patient recall logic, or explicit product rule.

Same-day reminder:
- Send at most one same-day reminder.
- Use it only when the appointment is unconfirmed, first visit, high value, long duration, or otherwise high no-show risk.
- Default timing is about 2 to 3 hours before the appointment.

Freed-slot offers:
- Momentum should re-check calendar availability before booking any offered slot.
- The offer should not guarantee that the slot is held unless Momentum has actually reserved or tentatively blocked it.
- Default MVP behavior is first-confirmed-first-booked with clear messaging if the slot is no longer available.
