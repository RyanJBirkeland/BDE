# T-32 · Add dedicated tests for data-mutating migrations (start with v038)

**Severity:** P1 · **Audit lens:** testing

## Context

`src/main/migrations/__tests__/` contains only `loader.test.ts` and `v049.test.ts`. Migrations v001–v048 and v050–v052 rely solely on the aggregate `runMigrations(db)` smoke test in `db.test.ts`, which proves the chain completes but not that each individual data-mutating migration handles a partially-applied prior state. v038 (`UPDATE sprint_tasks SET repo = lower(repo)`) is the clearest case that deserves its own test — it mutates existing data.

## Files to Change

- `src/main/migrations/__tests__/v038.test.ts` (new — per-migration test for v038 specifically)
- `CLAUDE.md` — add a one-line policy under "Key Conventions" stating that data-mutating migrations require a dedicated test, modeled on `v049.test.ts`.

## Implementation

Create `src/main/migrations/__tests__/v038.test.ts`. Model the structure on `v049.test.ts`. The test sets up a fresh SQLite DB, applies migrations v001..v037, seeds the relevant table (`sprint_tasks`) with fixtures that exercise the mutation path, then applies v038 and asserts the new state.

Minimum cases:

1. **Applies correctly** — insert rows with mixed-case `repo` values (`'BDE'`, `'Bde'`, `'bde'`); run v038; assert all rows have lowercase `repo`.
2. **Idempotent** — run v038 a second time; assert no change (rows still lowercase).
3. **No-op when already normalized** — insert only lowercase rows; run v038; assert zero row changes (use `db.changes()` or a snapshot).
4. **Does not touch unrelated columns** — insert rows with non-lowercase values in other text columns (`title`, `notes`); run v038; assert other columns unchanged.

Do not mutate the v038 migration itself. This task adds tests only.

Add one line to CLAUDE.md under "Key Conventions":

> Data-mutating migrations (any `UPDATE`/`DELETE` or CHECK-constraint change) require a dedicated test in `src/main/migrations/__tests__/vNNN.test.ts` modeled on `v049.test.ts`.

## How to Test

```bash
npm run typecheck
npm run test:main -- v038
npm run test:main -- migrations
npm run lint
```

## Acceptance

- `src/main/migrations/__tests__/v038.test.ts` exists with the four cases above.
- All cases pass.
- CLAUDE.md has the one-line policy.
- Full suite green.
