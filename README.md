# Momentum

Momentum is a new project workspace initialized for the Superpowers-style agentic development workflow.

## Workflow

This repository is prepared to use the process from [obra/superpowers](https://github.com/obra/superpowers):

1. Brainstorm the project or feature before implementation.
2. Write an approved design spec in `docs/superpowers/specs/`.
3. Write a detailed implementation plan in `docs/superpowers/plans/`.
4. Implement with test-driven development.
5. Review changes before moving to the next task.
6. Verify the finished branch before delivery.

## Codex App Setup

Superpowers is installed globally through the Codex App plugin marketplace:

1. Open **Plugins** in the Codex App sidebar.
2. Find **Superpowers** in the Coding section.
3. Click `+` and follow the prompts.

The files in this repo provide project-level workflow guidance, but they do not replace the official Codex App plugin.

## Current Status

The repository contains the first local backend slice for the Momentum MVP:

- clinic profile validation;
- fake calendar source-of-truth;
- scheduling workflows for booking, rescheduling, and cancellation;
- WhatsApp-style conversation workflow;
- outbound policies for reminders, reactivation, and freed-slot matching;
- local simulation API;
- Prisma SQLite schema for MVP persistence.

## Local Development

Install dependencies:

```bash
npm install
```

Create local environment:

```bash
cp .env.example .env
```

Prepare Prisma locally:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Run tests:

```bash
npm test
npm run typecheck
```

Start local API:

```bash
ENABLE_SIMULATION_API=true npm run dev
```

Simulate an inbound WhatsApp message:

```bash
curl -sS -X POST http://127.0.0.1:3000/simulate/inbound-message \
  -H 'content-type: application/json' \
  -d '{"clinicId":"clinic_1","conversationId":"conv_1","patientId":"pat_1","whatsappNumber":"+5491111111111","text":"Quiero reservar botox"}'
```
