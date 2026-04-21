import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { validateTransition } from '../../shared/task-state-machine'
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
  const affected = db
    .prepare(
      `SELECT ${SPRINT_TASK_COLUMNS}
       FROM sprint_tasks WHERE pr_number = ? AND status = ?`
    )
    .all(prNumber, 'active') as Array<Record<string, unknown>>

  // Filter to only tasks whose transition is valid per the state machine.
  // Skipped tasks are logged as warnings rather than silently dropped.
  const eligible = affected.filter((row) => {
    const currentStatus = row.status as string
    const validation = validateTransition(currentStatus, targetStatus)
    if (!validation.ok) {
      getSprintQueriesLogger().warn(
        `[sprint-pr-ops] transitionTasksByPrNumber: skipping task ${row.id as string}: ${validation.reason}`
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
  // Build query based on whether statusFilter is provided
  const selectQuery = statusFilter
    ? `SELECT ${SPRINT_TASK_COLUMNS}
       FROM sprint_tasks WHERE pr_number = ? AND status = ? AND pr_status = 'open'`
    : `SELECT ${SPRINT_TASK_COLUMNS}
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

export function markTaskDoneByPrNumber(prNumber: number, db?: Database.Database): string[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () =>
      conn.transaction(() => {
        const affectedIds = transitionTasksByPrNumber(conn, prNumber, 'done', 'pr-poller')
        updatePrStatusBulk(prNumber, 'merged', 'pr-poller', conn, 'done')
        return affectedIds
      })(),
    `markTaskDoneByPrNumber(pr=${prNumber})`,
    [],
    getSprintQueriesLogger()
  )
}

export function markTaskCancelledByPrNumber(prNumber: number, db?: Database.Database): string[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () =>
      conn.transaction(() => {
        const affectedIds = transitionTasksByPrNumber(conn, prNumber, 'cancelled', 'pr-poller')
        updatePrStatusBulk(prNumber, 'closed', 'pr-poller', conn)
        return affectedIds
      })(),
    `markTaskCancelledByPrNumber(pr=${prNumber})`,
    [],
    getSprintQueriesLogger()
  )
}

export function listTasksWithOpenPrs(db?: Database.Database): SprintTask[] {
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

export function updateTaskMergeableState(
  prNumber: number,
  mergeableState: string | null,
  db?: Database.Database
): void {
  if (!mergeableState) return
  const conn = db ?? getDb()
  withDataLayerError(
    () => {
      conn.transaction(() => {
        // Record pr_mergeable_state changes in the audit trail.
        // Read all affected tasks first so we can capture the old value per task.
        const sql = `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE pr_number = ?`
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
    },
    `updateTaskMergeableState(pr=${prNumber})`,
    undefined,
    getSprintQueriesLogger()
  )
}
