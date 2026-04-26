import type Database from 'better-sqlite3'
import type { SprintTaskPR } from '../../shared/types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { validateTransition, TASK_STATUSES } from '../../shared/task-state-machine'

const VALID_TASK_STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES)

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && VALID_TASK_STATUSES.has(value)
}
import { withRetryAsync } from './sqlite-retry'
import { getDb } from '../db'
import { recordTaskChangesBulk } from './task-changes'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-mapper'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { withDataLayerError } from './data-utils'

/**
 * Transitions active tasks to targetStatus for a given PR number.
 * Records audit trail and returns affected task IDs.
 * Throws on audit failure so the wrapping transaction rolls back atomically.
 */
function transitionTasksByPrNumber(
  db: Database.Database,
  prNumber: number,
  targetStatus: TaskStatus,
  changedBy: string
): string[] {
  // Narrow projection: the function only needs `id` (for the audit row + log
  // message) and `status` (for the state-machine guard); `completed_at` is
  // included so the bulk audit comparison sees the prior value before the
  // UPDATE overwrites it. The wide column list pulled hundreds of KB of
  // `review_diff_snapshot` per active PR on every poller cycle.
  const affected = db
    .prepare(
      `SELECT id, status, completed_at
       FROM sprint_tasks WHERE pr_number = ? AND status = ?`
    )
    .all(prNumber, 'active') as Array<Record<string, unknown>>

  // Filter to only tasks whose transition is valid per the state machine.
  // Rows with an unrecognised status are logged and skipped rather than
  // passed to validateTransition, which expects a narrowed TaskStatus.
  const eligible = affected.filter((row) => {
    if (!isTaskStatus(row.status)) {
      getSprintQueriesLogger().warn(
        `[sprint-pr-ops] transitionTasksByPrNumber: skipping task ${String(row.id)}: unrecognised status "${String(row.status)}"`
      )
      return false
    }
    const currentStatus = row.status
    const validation = validateTransition(currentStatus, targetStatus)
    if (!validation.ok) {
      getSprintQueriesLogger().warn(
        `[sprint-pr-ops] transitionTasksByPrNumber: skipping task ${String(row.id)}: ${validation.reason}`
      )
    }
    return validation.ok
  })

  const affectedIds = eligible.map((r) => r.id as string)

  if (affectedIds.length > 0) {
    const completedAt = nowIso()

    // Bulk audit trail — throw on failure so the wrapping transaction
    // rolls back the status UPDATE — both must succeed atomically.
    recordTaskChangesBulk(
      eligible.map((oldTask) => ({
        taskId: oldTask.id as string,
        oldTask,
        newPatch: { status: targetStatus, completed_at: completedAt }
      })),
      changedBy,
      db
    )

    const placeholders = affectedIds.map(() => '?').join(', ')
    const sql = `UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE id IN (${placeholders})`
    db.prepare(sql).run(targetStatus, completedAt, ...affectedIds)
  }

  return affectedIds
}

/**
 * Updates pr_status field for tasks with a given PR number.
 * Records audit trail. Optional statusFilter restricts which tasks are updated.
 */
function updatePrStatusBulk(
  prNumber: number,
  newStatus: 'merged' | 'closed',
  changedBy: string,
  db: Database.Database,
  statusFilter?: string
): void {
  // Narrow projection: the audit comparison only needs `id` and the prior
  // `pr_status` value, since the bulk patch is `{ pr_status: newStatus }`.
  const selectQuery = statusFilter
    ? `SELECT id, pr_status
       FROM sprint_tasks WHERE pr_number = ? AND status = ? AND pr_status = 'open'`
    : `SELECT id, pr_status
       FROM sprint_tasks WHERE pr_number = ? AND pr_status = 'open'`

  const updateQuery = statusFilter
    ? "UPDATE sprint_tasks SET pr_status = ? WHERE pr_number = ? AND status = ? AND pr_status = 'open'"
    : "UPDATE sprint_tasks SET pr_status = ? WHERE pr_number = ? AND pr_status = 'open'"

  // Get tasks where pr_status will change for audit
  const prStatusAffected = statusFilter
    ? (db.prepare(selectQuery).all(prNumber, statusFilter) as Array<Record<string, unknown>>)
    : (db.prepare(selectQuery).all(prNumber) as Array<Record<string, unknown>>)

  // Bulk audit trail for pr_status changes — throw on failure so the
  // wrapping transaction rolls back the pr_status UPDATE atomically.
  recordTaskChangesBulk(
    prStatusAffected.map((oldTask) => ({
      taskId: oldTask.id as string,
      oldTask,
      newPatch: { pr_status: newStatus }
    })),
    changedBy,
    db
  )

  // Execute the update
  if (statusFilter) {
    db.prepare(updateQuery).run(newStatus, prNumber, statusFilter)
  } else {
    db.prepare(updateQuery).run(newStatus, prNumber)
  }
}

export async function markTaskDoneByPrNumber(
  prNumber: number,
  db?: Database.Database
): Promise<string[]> {
  const conn = db ?? getDb()
  try {
    return await withRetryAsync(() =>
      conn.transaction(() => {
        const affectedIds = transitionTasksByPrNumber(conn, prNumber, 'done', 'pr-poller')
        updatePrStatusBulk(prNumber, 'merged', 'pr-poller', conn, 'done')
        return affectedIds
      })()
    )
  } catch (err) {
    getSprintQueriesLogger().warn(
      `[sprint-pr-ops] markTaskDoneByPrNumber(pr=${prNumber}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return []
  }
}

export async function markTaskCancelledByPrNumber(
  prNumber: number,
  db?: Database.Database
): Promise<string[]> {
  const conn = db ?? getDb()
  try {
    return await withRetryAsync(() =>
      conn.transaction(() => {
        const affectedIds = transitionTasksByPrNumber(conn, prNumber, 'cancelled', 'pr-poller')
        updatePrStatusBulk(prNumber, 'closed', 'pr-poller', conn)
        return affectedIds
      })()
    )
  } catch (err) {
    getSprintQueriesLogger().warn(
      `[sprint-pr-ops] markTaskCancelledByPrNumber(pr=${prNumber}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return []
  }
}

export function listTasksWithOpenPrs(db?: Database.Database): SprintTaskPR[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const rows = conn
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS}
           FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'`
        )
        .all() as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    },
    'listTasksWithOpenPrs',
    [],
    getSprintQueriesLogger()
  )
}

export async function updateTaskMergeableState(
  prNumber: number,
  mergeableState: string | null,
  db?: Database.Database
): Promise<void> {
  if (!mergeableState) return
  const conn = db ?? getDb()
  try {
    await withRetryAsync(() =>
      conn.transaction(() => {
        // Record pr_mergeable_state changes in the audit trail.
        // Narrow projection: the audit comparison only needs `id` and the
        // prior `pr_mergeable_state` value. The wide column list previously
        // dragged the heavy `review_diff_snapshot` blob through the PR
        // poller's 60s loop for every task with the matching pr_number.
        const sql = `SELECT id, pr_mergeable_state FROM sprint_tasks WHERE pr_number = ?`
        const affected = conn.prepare(sql).all(prNumber) as Array<Record<string, unknown>>

        recordTaskChangesBulk(
          affected.map((oldTask) => ({
            taskId: oldTask.id as string,
            oldTask,
            newPatch: { pr_mergeable_state: mergeableState }
          })),
          'pr-poller',
          conn
        )

        conn
          .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
          .run(mergeableState, prNumber)
      })()
    )
  } catch (err) {
    getSprintQueriesLogger().warn(
      `[sprint-pr-ops] updateTaskMergeableState(pr=${prNumber}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
