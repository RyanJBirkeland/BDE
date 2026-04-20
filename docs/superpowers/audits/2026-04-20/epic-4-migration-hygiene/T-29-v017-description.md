# T-29 · Replace placeholder description in migration v017

**Severity:** P1 · **Audit lens:** clean-code

## Context

`src/main/migrations/v017-add.ts:4` exports `description = 'Add '` — a placeholder with a trailing space. The description surfaces in `db.ts:128` error messages as `Migration v17 ("Add ") failed: ...`. A user who hits a first-launch migration failure sees a useless string. Migration v017 actually drops and recreates `sprint_tasks` to add new columns (blocked status, worktree/review columns).

## Files to Change

- `src/main/migrations/v017-add.ts` (line 4 — description string)
- Optionally rename the file if the existing filename stem is now misleading (leave it alone if it's just the description that's bad; migration files are append-only by convention).

## Implementation

Read `v017-add.ts` fully and identify what the migration does (what columns it adds, what CHECK constraints it changes). Replace the description with one clear sentence describing the change:

```ts
export const description = 'Recreate sprint_tasks with blocked status and worktree/review columns'
```

Use whatever exact description matches what the migration actually does — the above is a starting guess based on the filename stem. Verify against the `CREATE TABLE sprint_tasks_v17` body.

Do not rewrite the migration body. Do not change the version number. Do not backport this change to any running DB's stored migration history (migrations are immutable once shipped).

## How to Test

```bash
npm run typecheck
npm run test:main -- migrations
npm run lint
```

Manual: trigger a migration failure in a local test DB (e.g. point `DB_PATH` at a temp path and inject a syntax error in a SQL string) and confirm the error dialog shows the new description. Revert the temp break after testing.

## Acceptance

- `description` in `v017-add.ts` accurately summarizes the migration in one sentence.
- Migration test suite still green (`npm run test:main -- migrations`).
- Full suite green.
