# Google Calendar Direct Slot Locks Design

## Decision

Momentum will keep Google Calendar as the direct calendar integration for the product core. Cal.com is not part of the core architecture.

The production path is:

```text
Kapso WhatsApp -> Momentum backend -> receptionist agent/policies -> SchedulingService -> Google Calendar
```

The model interprets conversation and proposes intent. Momentum owns business facts, state, slot selection, confirmation, booking, cancellation, rescheduling, locks, audit, and handoff.

## Problem

The current booking flow re-checks Google Calendar before creating an appointment, so it prevents actual double booking. That protects the calendar, but it does not prevent two conversations from being offered the same available slot while both are deciding.

That creates bad reception behavior:

1. Patient A receives a slot.
2. Patient B receives the same slot before A confirms.
3. One patient confirms first.
4. The other patient later gets "that slot is no longer available."

For a real receptionist simulation, an offered slot should be held briefly.

## Proposed Behavior

When Momentum offers a slot from Google Calendar availability, it creates a soft slot lock:

- scoped by clinic, conversation, service, professional/calendar, startsAt, endsAt
- expires after 10 minutes
- blocks other conversations from being offered the same overlapping calendar time
- does not block the owning conversation from confirming
- is released when the pending booking is replaced, cleared, cancelled, or consumed
- is ignored after expiration

Calendar remains the final source of truth at booking time. A slot lock improves the offer/confirmation UX, but booking still re-checks Google Calendar and handles external calendar changes safely.

## Data Model

Add `SlotLock`:

```text
id
clinicId
conversationId
serviceId
professionalId
calendarId
startsAt
endsAt
expiresAt
status: active | released | consumed
createdAt
updatedAt
```

`PendingBooking` stores `slotLockId` and `slotLockExpiresAt` when the offer came from the automated booking flow.

## Repository Contract

Add repository methods:

- `claimSlotLock(input)` returns a lock or `undefined` if another active lock overlaps.
- `listActiveSlotLocks(input)` returns active unexpired locks in a range, optionally excluding the same conversation.
- `releaseSlotLock(input)` marks a lock released.
- `consumeSlotLock(input)` marks a lock consumed after successful booking/reschedule.

## Scheduling Rules

- `SchedulingService.findSlots` filters out active locks owned by other conversations.
- `SchedulingService.bookAppointment` rejects a slot if it is locked by another conversation.
- On successful appointment creation, the workflow consumes the pending lock.
- On pending booking clear/replacement, the workflow releases the old lock.

## Out Of Scope

- Cal.com integration.
- WhatsApp Flow UI changes.
- Redis/distributed locks. The database-backed lock is enough for this stage.
- Full multi-slot option picking. Momentum still offers the first safe slot for now.

