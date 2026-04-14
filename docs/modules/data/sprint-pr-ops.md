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

## Key Dependencies
- `task-changes.ts` — `recordTaskChangesBulk` for bulk audit trail (single prepared INSERT reused across tasks)
- `sprint-task-mapper.ts` — `mapRowsToTasks` for row hydration
- `sprint-query-constants.ts` — `SPRINT_TASK_COLUMNS` column list
- `data-utils.ts` — `withDataLayerError` for error logging + fallback on all exported functions
