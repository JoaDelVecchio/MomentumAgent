# Momentum Agent Instructions

Use the Superpowers workflow from `obra/superpowers` for this project.

## Default Development Flow

- Before writing app code for a new feature, explore the repo, ask clarifying questions one at a time, propose approaches, and present a design for approval.
- Save approved designs to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
- After a design is approved, write an implementation plan in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- Plans must use small, testable tasks with exact file paths, commands, expected results, and no placeholders.
- Implement with RED-GREEN-REFACTOR test-driven development.
- Keep commits small and scoped to completed, verified work.
- Run a code review pass between implementation tasks when behavior or shared code changes.
- Before declaring work complete, run the relevant tests and verify the requested behavior end to end.

## Project Boundaries

- Do not add application code until the Momentum product spec is approved, unless the user explicitly overrides this workflow.
- Prefer simple, local project structure over framework setup until the product requirements justify a stack.
- Keep unrelated refactors out of feature work.

## Codex Plugin Note

Install the official Superpowers plugin in Codex App for automatic skill triggering. These instructions are a repository fallback for agents working in this project.
