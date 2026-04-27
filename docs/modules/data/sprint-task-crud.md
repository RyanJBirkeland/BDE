# sprint-task-crud

**Layer:** Data
**Source:** `src/main/data/sprint-task-crud.ts`

## Purpose
CRUD operations for sprint tasks. Owns single-row reads, the filter+pagination list path, the recent-activity list path that the renderer polls, the audit-aware update path, and the operator force-update escape hatch.

## Public API
- `getTask(id, db?)` — single-row read; full row including `review_diff_snapshot` (used by the audit path before `updateTask`)
- `listTasks(statusOrOptions?, db?)` — filter + pagination push-down (status, repo, epicId, tag substring via `json_each`, search across title + spec, limit/offset)
- `listTasksRecent(db?)` — renderer poll path. UNION ALL of two index-able branches (active set + 7-day terminal window). Projects `SPRINT_TASK_LIST_COLUMNS` — the heavy `review_diff_snapshot` JSON blob is excluded so the 30s renderer poll doesn't transfer hundreds of KB per task on every cycle. Code Review Station fetches the snapshot on demand from the worktree.
- `createTask(input, db?)` — INSERT with `RETURNING`; sanitizes `depends_on` and `tags` JSON
- `createReviewTaskFromAdhoc(input)` — promotes an adhoc agent's worktree directly to a `review` task (bypasses the normal state machine)
- `updateTask(id, patch, options?, db?)` — allowlisted UPDATE with state-machine transition guard, audit trail, and optional `caller` attribution
- `forceUpdateTask(id, patch, db?)` — operator escape-hatch (skips state-machine validation, attributed `'manual-override'`)
- `deleteTask(id, deletedBy?, db?)` — DELETE with audit-trail snapshot

## Key Dependencies
- `sprint-query-constants.ts` — `SPRINT_TASK_COLUMNS` (full row reads), `SPRINT_TASK_LIST_COLUMNS` (poll-path reads)
- `sprint-task-mapper.ts` — `mapRowToTask`/`mapRowsToTasks` row hydration, `serializeFieldForStorage` write encoding
- `sprint-task-types.ts` — `UPDATE_ALLOWLIST`, `COLUMN_MAP`, `CreateTaskInput`
- `task-changes.ts` — `recordTaskChanges` audit-trail writer
- `task-state-machine.ts` — `validateTransition`, `isTaskStatus`
- `data-utils.ts` — `withDataLayerError` error wrapper
