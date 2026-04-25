## Why

Every renderer poll (every 3 seconds) transfers the full `sprint_tasks` row including the `review_diff_snapshot` column — a blob that can be 500KB per task. At 50 tasks that's 25MB per poll cycle. The drain loop re-reads every task after every successful claim. Dependency refresh re-reads every row every 30 seconds regardless of what changed. State-machine validation still lives in the data layer after EP-1 extracted policy to `TaskStateService` — a cleanup left behind.

## What Changes

- All `SELECT *` queries replaced with explicit column projections using `SPRINT_TASK_LIST_COLUMNS` (excludes `review_diff_snapshot`) — T-124 already done for `listTasksRecent` in wave 1; extend to remaining list queries
- `processQueuedTask` post-claim reload replaced with targeted fetch of only the claimed task — not a full catalog rescan
- Dependency refresh becomes targeted: only re-reads tasks whose IDs appear in the dirty set, not every row
- `sprint-task-crud.ts` secondary defense-in-depth assertion cleaned up to align with EP-1 (state-machine validation is `TaskStateService`'s job)
- `sprint-queries.ts` barrel re-export documented and its role clarified (backward-compat shim, not the primary import path)

## Capabilities

### New Capabilities

- `targeted-data-queries`: Explicit column projection on all list queries; targeted post-claim reload; incremental dep-refresh

### Modified Capabilities

<!-- No spec-level behavior changes — same data, less I/O -->

## Impact

- `src/main/data/sprint-task-crud.ts` — all list queries project columns explicitly
- `src/main/data/sprint-query-constants.ts` — `SPRINT_TASK_LIST_COLUMNS` already exists; verify all list sites use it
- `src/main/agent-manager/drain-loop.ts` — targeted post-claim reload
- `src/main/agent-manager/dependency-refresher.ts` — incremental dirty-set refresh
- `src/main/data/sprint-task-mapper.ts` — `mapRowsToTasks` exported cleanly for batch use
