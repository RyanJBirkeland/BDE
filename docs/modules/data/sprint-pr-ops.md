# sprint-pr-ops

**Layer:** Data
**Source:** `src/main/data/sprint-pr-ops.ts`

## Purpose
PR lifecycle queries for sprint tasks. Transitions tasks to done/cancelled on PR merge/close, updates mergeable state, and lists tasks with open PRs.

## Public API
- `markTaskDoneByPrNumber(prNumber, db?)` — transitions active tasks matching the PR to `done`, sets `completed_at`, bulk-records audit trail
- `markTaskCancelledByPrNumber(prNumber, db?)` — transitions active tasks matching the PR to `cancelled`, bulk-records audit trail
- `updateTaskMergeableState(prNumber, mergeableState, db?)` — sets `pr_mergeable_state` for all tasks with the given PR number; uses `recordTaskChangesBulk` for audit
- `listTasksWithOpenPrs(db?)` — returns tasks where `pr_status = 'open'`
- `updatePrDetails(taskId, patch)` — sets `pr_url`, `pr_number`, `pr_status` on a task and records audit trail

## Implementation notes
- Audit-comparison reads use narrow projections (`id, status, completed_at` for the transition path, `id, pr_status` for the bulk pr_status update, `id, pr_mergeable_state` for the mergeable-state update). The wide `SPRINT_TASK_COLUMNS` list previously dragged the multi-hundred-KB `review_diff_snapshot` blob through the PR poller's 60s loop on every cycle.

## Key Dependencies
- `task-changes.ts` — `recordTaskChangesBulk` for bulk audit trail (single prepared INSERT reused across tasks)
- `sprint-task-mapper.ts` — `mapRowsToTasks` for row hydration in `listTasksWithOpenPrs`
- `sprint-query-constants.ts` — `SPRINT_TASK_COLUMNS` for the `listTasksWithOpenPrs` projection
- `data-utils.ts` — `withDataLayerError` for error logging + fallback on all exported functions
