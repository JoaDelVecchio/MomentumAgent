# Prisma Operational Persistence Design

Date: 2026-05-30
Status: Approved for implementation plan

## Summary

Momentum already has the core WhatsApp/Kapso and Google Calendar flow, but the real WhatsApp runtime still uses in-memory repositories for patients, conversations, appointments, opt-out, webhook idempotency, and audit events.

This block makes the real WhatsApp runtime durable enough for a pilot by persisting only the operational state required to avoid lost conversations, duplicate webhook effects, forgotten handoffs, and missing appointment records after a restart.

## Goal

When a patient talks to Momentum through the real Kapso webhook, Momentum must persist the state needed to continue the booking flow across process restarts and webhook retries.

The implementation should keep the existing product behavior and workflow text unchanged. This is an infrastructure/state block, not a new agent-intelligence block.

## Non-Goals

This block does not include:
- customer dashboard;
- onboarding UI;
- fully editable clinic/service/professional configuration;
- roles, permissions, or staff accounts;
- production-grade multi-clinic administration;
- analytics dashboards;
- reminder/reactivation/freed-slot schedulers;
- OpenAI-powered intent interpretation;
- replacing Google Calendar or adding Outlook.

## Product Decisions

- Use Prisma because it is already in the project, the schema already models most needed entities, and it can move from SQLite local to Postgres later without changing application contracts.
- Persist only operational state needed by the external patient agent.
- Keep local simulation routes on in-memory repositories unless a test explicitly needs Prisma. This preserves fast local development and limits blast radius.
- Keep clinic profile configuration seeded/config-driven for now. Do not build a full onboarding persistence model until the onboarding workflow is designed.
- Real WhatsApp/Kapso runtime should use Prisma-backed repositories and Prisma-backed audit logging.

## Required Capabilities

Repository persistence:
- Persist and read patients by `patientId`.
- Persist and read conversations by `conversationId`, including `botPaused` and `pendingBooking`.
- Persist and read appointments, including `calendarEventId`, `calendarId`, times, status, service, professional, clinic, and patient.
- Persist and read patient interests used for freed-slot matching.
- Persist and read opt-out state by WhatsApp number.
- Generate stable appointment ids without relying on process memory.
- Keep the existing `withAppointmentLock()` repository API. The Prisma implementation will serialize operations in-process for the local pilot; distributed locking is out of scope for this block.

Audit persistence:
- Store audit events in the existing `AuditEvent` table.
- Preserve existing `AuditLogPort.record()` behavior.
- Store metadata as JSON text and return parsed metadata.

Webhook idempotency:
- Add durable storage for processed webhook delivery keys.
- `hasProcessedWebhookDelivery()` must return true after a previous process marked the key.
- `markProcessedWebhookDelivery()` must be idempotent.
- Duplicate Kapso deliveries must not cause duplicate replies or duplicate appointments after restart.

Runtime wiring:
- The real WhatsApp runtime should use Prisma repositories and Prisma audit log.
- Google Calendar credentials continue using Prisma as already implemented.
- The app should disconnect Prisma cleanly on shutdown.
- If `WHATSAPP_PROVIDER` is not set, no WhatsApp persistence runtime is required.

## Data Flow

1. Kapso sends a signed inbound webhook.
2. Momentum verifies and normalizes it.
3. `WhatsAppInboundService` checks durable webhook idempotency.
4. If new, `ConversationWorkflow` loads durable patient/conversation state.
5. If the patient is mid-booking, the stored `pendingBooking` continues the flow.
6. If the booking confirms, `SchedulingService` creates/updates the Google Calendar event and stores the appointment in Prisma.
7. Momentum sends the WhatsApp reply through Kapso.
8. Momentum marks the webhook delivery as processed only after successful outbound send.
9. Audit events are written to Prisma.

## Schema Notes

The existing Prisma schema already includes:
- `Patient`
- `Conversation`
- `Appointment`
- `PatientInterest`
- `AuditEvent`
- `CalendarConnection`

This block adds one small table for processed webhook deliveries:
- `provider`;
- `idempotencyKey`;
- `clinicId`;
- `conversationId`;
- `providerMessageId`;
- `processedAt`;

The table must enforce uniqueness on `(provider, idempotencyKey)`.

## Error Handling

- Invalid persisted JSON should fail loudly in tests and not silently corrupt workflow state.
- Duplicate webhook marks should be safe and not throw.
- Prisma unique conflicts on idempotency should be treated as duplicate delivery state.
- Calendar provider errors should keep the existing 503 behavior.
- Kapso send failures should not mark the webhook as processed, so retries remain possible.

## Testing Requirements

Tests must cover:
- Prisma repository round-trips for patients, conversations, appointments, interests, opt-out, and idempotency.
- Prisma audit log round-trip with metadata parsing.
- Restart simulation: one repository instance stores a pending booking; a second instance continues the conversation from Prisma.
- Duplicate webhook simulation across repository instances.
- Existing in-memory simulation API remains compatible.
- Full suite, typecheck, and Prisma schema validation pass.

## Acceptance Criteria

- Real WhatsApp/Kapso runtime no longer depends on in-memory state for operational patient-agent data.
- Booking state survives replacing repository/audit instances with new ones backed by the same database.
- Duplicate webhook deliveries remain ignored across process restarts.
- Handoff pause and opt-out survive process restarts.
- App behavior and existing tests remain compatible.
- The implementation does not introduce dashboard/onboarding scope.
