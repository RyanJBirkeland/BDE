## Context

`recoverOrphans` in `orphan-recovery.ts` finds tasks stuck in `active` status and calls `resetTaskForRetry(id)` on each. There is no per-task recovery counter. A task that crashes FLEET on every startup loops indefinitely. The recovery run is not broadcast to the renderer — users see no indication that tasks were rescued or that some are stuck in a crash loop. `review`-status tasks with an open PR are left in `review` on recovery even though the PR may have merged while FLEET was down.

## Goals / Non-Goals

**Goals:**
- Add `orphan_recovery_count` column (migration) and increment it on each recovery
- Cap at `MAX_ORPHAN_RECOVERY_COUNT = 3`; tasks at cap → `error` with `failure_reason = 'exhausted: orphan recovery cap reached'`
- Broadcast `orphan:recovered` with `{ recovered: string[], exhausted: string[] }` after recovery
- SprintPipeline shows a dismissible banner when `orphan:recovered` fires
- Enrich recovery log with `retry_count`, `started_at`, prior status per task
- Suppress duplicate "has PR, clearing claimed_by" lines after first per session

**Non-Goals:**
- Auto-resolving `review` PR state (complex; requires GitHub API call at startup)
- Persisting recovery history beyond the counter

## Decisions

### D1: Migration adds `orphan_recovery_count INTEGER NOT NULL DEFAULT 0`

New column, no existing data to migrate. `resetTaskForRetry` increments it via `UPDATE sprint_tasks SET orphan_recovery_count = orphan_recovery_count + 1`. The cap check happens before `resetTaskForRetry` — tasks at cap get `updateTask({ status: 'error', failure_reason: '...' })` instead.

### D2: `orphan:recovered` broadcast fires once per startup after recovery

Emitted from `index.ts` after `recoverOrphans()` returns, only if `recovered.length > 0 || exhausted.length > 0`. The renderer listens via `onBroadcast('orphan:recovered')` and sets a transient banner state in `sprintUI` store.

### D3: Duplicate PR-clearing log suppressed via module-level boolean

`orphan-recovery.ts` tracks whether it has already logged "has PR, clearing claimed_by" in the current process lifetime. First occurrence logs at INFO; subsequent are swallowed.

### D4: `review` orphans logged, not re-queued

A task in `review` with `claimed_by` set is unusual (worktree preserved means it shouldn't have `claimed_by`). Log a WARN with `taskId` and `pr_url` if present. Do not re-queue — the user needs to action it from Code Review Station.

## Risks / Trade-offs

- **Risk**: Cap of 3 is too low for flaky environments → constant `MAX_ORPHAN_RECOVERY_COUNT` is easy to tune; also logged prominently so operators can adjust
- **Trade-off**: Incrementing the counter in `resetTaskForRetry` couples recovery semantics into a shared utility — alternatives: increment in `recoverOrphans` caller; either works, caller is cleaner but requires passing the count through
