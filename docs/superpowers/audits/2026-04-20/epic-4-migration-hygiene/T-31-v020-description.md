# T-31 · Replace placeholder description in migration v020

**Severity:** P1 · **Audit lens:** clean-code

## Context

`src/main/migrations/v020-add.ts:4` has the same `description = 'Add '` placeholder as v017. This migration adds the `review` status to the `sprint_tasks` CHECK constraint — the single most important user-visible state transition in the pipeline — and the description says nothing about it.

## Files to Change

- `src/main/migrations/v020-add.ts` (line 4 — description string)

## Implementation

Read `v020-add.ts` fully. Replace the description with a clear sentence describing the change. Based on the filename and the repository context, the migration recreates `sprint_tasks` with an updated CHECK constraint that includes the `review` status:

```ts
export const description = 'Add review status to sprint_tasks CHECK constraint'
```

Verify against the actual `CREATE TABLE sprint_tasks_v20` body and the `CHECK (status IN (...))` clause. Use the exact description that matches.

Same constraints as T-29: do not modify the migration body, do not change the version number, do not touch stored migration history.

## How to Test

```bash
npm run typecheck
npm run test:main -- migrations
npm run lint
```

## Acceptance

- `description` in `v020-add.ts` accurately summarizes the migration in one sentence.
- Migration test suite still green.
- Full suite green.
