# Data

Repository and query layer. All SQLite access lives here.
Source: `src/main/data/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| [sprint-pr-ops](sprint-pr-ops.md) | PR lifecycle queries — mark done/cancelled, update mergeable state, list open PRs | `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `updateTaskMergeableState`, `listTasksWithOpenPrs` |
| `sprint-maintenance.ts` | SQLite maintenance ops for sprint_tasks: diff-snapshot pruning, test-artifact cleanup | `pruneOldDiffSnapshots`, `cleanTestArtifacts`, `DIFF_SNAPSHOT_RETENTION_DAYS` |
| `sprint-maintenance-facade.ts` | Stable re-export path for maintenance utilities (snapshot pruning, FK cleanup, update allowlist, test cleanup) | `cleanTestArtifacts`, `pruneOldDiffSnapshots`, `DIFF_SNAPSHOT_RETENTION_DAYS`, `UPDATE_ALLOWLIST`, `clearSprintTaskFk` |
