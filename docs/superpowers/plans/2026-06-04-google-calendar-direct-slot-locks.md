# Google Calendar Direct Slot Locks Plan

## Task 1: Extend Repository Contract

Files:
- `src/ports/repositories.ts`
- `src/adapters/memory/repositories.ts`
- `src/adapters/prisma/operational-repository.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260604000000_add_slot_locks/migration.sql`
- `tests/repository-port.test.ts`
- `tests/prisma-operational-repository.test.ts`

Commands:
- `npx vitest run tests/repository-port.test.ts tests/prisma-operational-repository.test.ts -t "slot lock|async repository"`

Expected result:
- Repository implementations can claim, list, release, and consume slot locks.
- Prisma tests may still require the local `sqlite3` binary.

## Task 2: Filter Availability And Protect Booking

Files:
- `src/application/scheduling/scheduling-service.ts`
- `tests/scheduling-service.test.ts`

Commands:
- `npx vitest run tests/scheduling-service.test.ts`

Expected result:
- Active slot locks hide slots from other conversations.
- Expired locks do not hide slots.
- Booking is rejected when another conversation owns an active overlapping lock.
- Booking succeeds for the owning conversation.

## Task 3: Wire Conversation Pending Booking Locks

Files:
- `src/application/conversations/conversation-workflow.ts`
- `tests/conversation-workflow.test.ts`
- `tests/conversation-workflow-receptionist-agent.test.ts`
- `tests/conversation-workflow-ai.test.ts`

Commands:
- `npx vitest run tests/conversation-workflow.test.ts tests/conversation-workflow-receptionist-agent.test.ts tests/conversation-workflow-ai.test.ts`

Expected result:
- Offering a slot stores a pending booking with a lock.
- Replacing or clearing a pending booking releases its old lock.
- Confirming a booking consumes its lock.
- Another conversation is not offered an actively held slot.

## Task 4: Verification

Commands:
- `npm run prisma:generate`
- `npx vitest run tests/scheduling-service.test.ts tests/conversation-workflow.test.ts tests/conversation-workflow-receptionist-agent.test.ts tests/conversation-workflow-ai.test.ts tests/repository-port.test.ts`
- `npm run typecheck`
- `git diff --check`

Expected result:
- Relevant tests and typecheck pass.
- Full `npx vitest run` may remain blocked by missing local `sqlite3` unless installed.

