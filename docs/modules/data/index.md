# Data

Repository and query layer. All SQLite access lives here.
Source: `src/main/data/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| [sprint-pr-ops](sprint-pr-ops.md) | PR lifecycle queries — mark done/cancelled, update mergeable state, list open PRs. All functions accept optional `db?: Database.Database` for injection. | `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `updateTaskMergeableState`, `listTasksWithOpenPrs` |
| `sprint-task-crud.ts` | CRUD operations for sprint tasks. All exported functions accept optional `db?: Database.Database`. | `getTask`, `listTasks`, `listTasksRecent`, `createTask`, `updateTask`, `deleteTask`, `createReviewTaskFromAdhoc` |
| `sprint-queue-ops.ts` | Queue claim/release/WIP operations. All exported functions accept optional `db?: Database.Database`. | `claimTask`, `releaseTask`, `getActiveTaskCount`, `getQueuedTasks` |
| `sprint-agent-queries.ts` | Agent-specific health and dependency queries. All exported functions accept optional `db?: Database.Database`. | `getQueueStats`, `getOrphanedTasks`, `clearStaleClaimedBy`, `clearSprintTaskFk`, `getHealthCheckTasks`, `getAllTaskIds`, `getTasksWithDependencies` |
| `sprint-planning-queries.ts` | Sprint CRUD queries. All exported functions accept optional `db?: Database.Database`. | `createSprint`, `getSprint`, `getAllSprints`, `updateSprint`, `deleteSprint`, `getSprintTasks` |
| `task-changes.ts` | Audit trail — field-level change recording. Functions accept optional `db?: Database.Database`. | `recordTaskChanges`, `recordTaskChangesBulk`, `getTaskChanges`, `pruneOldChanges` |
| `task-group-queries.ts` | Task group (epic) CRUD and dependency management. Functions accept optional `db?: Database.Database`. | `createGroup`, `listGroups`, `getGroup`, `updateGroup`, `deleteGroup`, `addTaskToGroup`, `removeTaskFromGroup`, `getGroupTasks`, `queueAllGroupTasks`, `reorderGroupTasks`, `addGroupDependency`, `removeGroupDependency`, `updateGroupDependencyCondition`, `getGroupsWithDependencies` |
| `webhook-queries.ts` | Webhook CRUD. All exported functions accept optional `db?: Database.Database`. | `listWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`, `getWebhookById`, `getWebhooks` |
| `dashboard-queries.ts` | Dashboard wrapper — delegates to agent-queries. Transforms raw DB rows to camelCase `DashboardEvent` (including JSON-parsed `payload`) before returning. Functions accept optional `db?: Database.Database`. | `getCompletionsPerHour`, `getRecentEvents` |
| `reporting-queries.ts` | Analytics queries for sprint tasks. All functions accept optional `db?: Database.Database`. | `getDoneTodayCount`, `getFailureReasonBreakdown`, `getTaskRuntimeStats`, `getSuccessRateBySpecType`, `getDailySuccessRate` |
| `sprint-maintenance.ts` | SQLite maintenance ops for sprint_tasks: diff-snapshot pruning, test-artifact cleanup | `pruneOldDiffSnapshots`, `cleanTestArtifacts`, `DIFF_SNAPSHOT_RETENTION_DAYS` |
| `sprint-maintenance-facade.ts` | Stable re-export path for maintenance utilities (snapshot pruning, FK cleanup, update allowlist, test cleanup) | `cleanTestArtifacts`, `pruneOldDiffSnapshots`, `DIFF_SNAPSHOT_RETENTION_DAYS`, `UPDATE_ALLOWLIST`, `clearSprintTaskFk` |
| `data-utils.ts` | Shared error-handling utility for the data layer. Eliminates the repeated try/catch log-and-return pattern. | `withDataLayerError` |
