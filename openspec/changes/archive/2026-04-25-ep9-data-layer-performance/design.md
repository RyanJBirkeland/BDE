## Context

`listTasksRecent` (the renderer poll query) already uses `SPRINT_TASK_LIST_COLUMNS` (wave 1 / T-124). But several other list queries still do `SELECT *`: the claim query, the orphan-recovery scan, the dep-refresh scan, and the agent-health queries. Each one transfers `review_diff_snapshot` unnecessarily. The post-claim reload in `drain-loop.ts` fetches all tasks in the queue to find the one just claimed — O(N) when O(1) is available. `dependency-refresher.ts` calls `getTasksWithDependencies()` which scans the full table every 30s.

## Goals / Non-Goals

**Goals:**
- Ensure every `SELECT` in the data layer projects only the columns it actually uses
- Replace the post-claim full-catalog reload with `getTask(claimedId)`
- Make `refreshDependencyIndex` use an incremental dirty-set path when available
- Export `mapRowsToTasks` from `sprint-task-mapper.ts` as a clean batch utility

**Non-Goals:**
- Adding database indexes (separate concern)
- FTS5 full-text search (T-127, larger change)
- Changing the SQLite schema

## Decisions

### D1: Audit every `db.prepare('SELECT')` for `*` usage

Grep `src/main/data/` for `SELECT \*` and `SELECT\s+\*`. For each hit, replace with an explicit column list. Use `SPRINT_TASK_COLUMNS` (full row, used when `review_diff_snapshot` is needed) or `SPRINT_TASK_LIST_COLUMNS` (excludes blob, used for list/poll queries). These constants already exist in `sprint-query-constants.ts`.

### D2: Post-claim reload uses `repo.getTask(id)`

After `claimTask(id)` succeeds in `drain-loop.ts`, the current code calls `listTasksRecent()` or equivalent to get the full task object. Replace with `repo.getTask(claimedId)` — one row by primary key.

### D3: Incremental dep-refresh via dirty set

`refreshDependencyIndex` already has a `DepsFingerprint` map for change detection. When the fingerprint hasn't changed for a task, skip re-reading it. Add a `dirtyTaskIds?: Set<string>` parameter — when provided, only re-read those tasks plus any with a changed fingerprint. Drain loop passes the set of tasks it just processed.

### D4: `mapRowsToTasks` exported as a named utility

Currently `mapRowToTask` is exported; `mapRowsToTasks` (batch variant) may be inline or unexported. Export it so callers doing bulk reads don't need to `.map(mapRowToTask)` inline everywhere.

## Risks / Trade-offs

- **Risk**: Missing a `SELECT *` site causes continued blob transfer → Mitigation: grep is exhaustive; add a lint comment in `sprint-query-constants.ts` warning about `SELECT *`
- **Trade-off**: Incremental dep-refresh adds complexity to `dependency-refresher.ts` — justified by the 30s full-table scan elimination
