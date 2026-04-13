# Migration v36 — restore dropped sprint_tasks indexes

## Problem

Migration v15 in `src/main/db.ts` (around line 443-454) created three indexes on `sprint_tasks`:

- `idx_sprint_tasks_status`
- `idx_sprint_tasks_claimed_by`
- `idx_sprint_tasks_pr_number`

Migrations v17 and v20 each did a full table rewrite (CREATE new → INSERT SELECT → DROP old → RENAME) to alter the `status` CHECK constraint. In both cases the index-recreation block only re-created `idx_sprint_tasks_status`. After v20 runs, `claimed_by` and `pr_number` are unindexed.

These columns are queried on hot paths:

- `getOrphanedTasks(claimedBy)` — agent manager startup
- `markTaskDoneByPrNumber` / `markTaskCancelledByPrNumber` / `updateTaskMergeableState` / `listTasksWithOpenPrs` — sprint PR poller, runs every 60s

Each is currently a full table scan. Alpha and Bravo Architects both flagged this as CRITICAL.

## Solution

Add migration v36 to the `migrations` array in `src/main/db.ts`. Insert it after the existing v35 entry (which is the last entry in the array, around line 874-886). Follow the exact same shape as v35 — same key ordering, same `up: (db) => { ... }` pattern.

The migration body should issue two `CREATE INDEX IF NOT EXISTS` statements via the existing better-sqlite3 API used throughout the file (read v15, v17, v20 to see the exact pattern). The `IF NOT EXISTS` guard makes the migration idempotent — safe even if the indexes happen to exist on some users' DBs.

The two index names to create are exactly:

- `idx_sprint_tasks_claimed_by` on column `claimed_by`
- `idx_sprint_tasks_pr_number` on column `pr_number`

The `description` field should mention these were dropped in v17/v20 table rewrites, so future contributors understand the history.

Do NOT add any other indexes in this task. Do NOT modify the `runMigrations` function. Do NOT touch v17 or v20.

## Files to Change

- `src/main/db.ts` — append v36 entry to the migrations array
- A new test file `src/main/__tests__/db-migrations.test.ts` — see "How to Test"

## How to Test

1. First check whether a migrations test file already exists: `grep -rn "runMigrations" src/main/__tests__/`. If one exists, add the new test there. If none exists, create `src/main/__tests__/db-migrations.test.ts`.
2. The new test should:
   - Open an in-memory better-sqlite3 database
   - Call `runMigrations(db)` from `src/main/db.ts`
   - Read `db.pragma("index_list('sprint_tasks')")`
   - Assert both `idx_sprint_tasks_claimed_by` and `idx_sprint_tasks_pr_number` are present in the result
3. `npm run test:main` — new test must pass
4. `npm run typecheck`, `npm test`, `npm run lint` — must all pass
5. By inspection, confirm the last entry in the `migrations` array is `version: 36`.

## Out of Scope

- Compound indexes such as `(status, completed_at)` — separate optimization task
- Any schema-snapshot test — separate task
- Updating CLAUDE.md migration version reference — separate doc task
- Restructuring earlier migrations
- Modifying `pruneOldDiffSnapshots` or any pruning helper
