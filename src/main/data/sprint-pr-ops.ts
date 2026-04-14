import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import { getDb } from '../db'
import { recordTaskChanges, recordTaskChangesBulk } from './task-changes'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-mapper'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { getErrorMessage } from '../../shared/errors'

/**
 * Transitions active tasks to done status for a given PR number.
 * Records audit trail and returns affected task IDs.
 */
function transitionTasksToDone(
  prNumber: number,
  changedBy: string,
  db: Database.Database
): string[] {
  // Get affected tasks with full state for audit trail
  const affected = db
    .prepare(
      `SELECT ${SPRINT_TASK_COLUMNS}
       FROM sprint_tasks WHERE pr_number = ? AND status = ?`
    )
    .all(prNumber, 'active') as Array<Record<string, unknown>>

  const affectedIds = affected.map((r) => r.id as string)

  if (affectedIds.length > 0) {
    const completedAt = nowIso()

    // Bulk audit trail (single prepared INSERT statement reused
    // across all affected tasks instead of one prepared statement per call).
    // Throw on audit failure so the wrapping transaction rolls back the
    // status UPDATE — both must succeed atomically.
    recordTaskChangesBulk(
      affected.map((oldTask) => ({
        taskId: oldTask.id as string,
        oldTask,
        newPatch: { status: 'done', completed_at: completedAt }
      })),
      changedBy,
      db
    )

    // Transition active tasks to done
    db.prepare(
      'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
    ).run('done', completedAt, prNumber, 'active')
  }

  return affectedIds
}

/**
 * Transitions active tasks to cancelled status for a given PR number.
 * Records audit trail and returns affected task IDs.
 */
function transitionTasksToCancelled(
  prNumber: number,
  changedBy: string,
  db: Database.Database
): string[] {
  // Get affected tasks with full state for audit trail
  const affected = db
    .prepare(
      `SELECT ${SPRINT_TASK_COLUMNS}
       FROM sprint_tasks WHERE pr_number = ? AND status = ?`
    )
    .all(prNumber, 'active') as Array<Record<string, unknown>>

  const affectedIds = affected.map((r) => r.id as string)

  if (affectedIds.length > 0) {
    const completedAt = nowIso()

    // Bulk audit trail — throw on failure so the wrapping transaction
    // rolls back the status UPDATE — both must succeed atomically.
    recordTaskChangesBulk(
      affected.map((oldTask) => ({
        taskId: oldTask.id as string,
        oldTask,
        newPatch: { status: 'cancelled', completed_at: completedAt }
      })),
      changedBy,
      db
    )

    // Transition active tasks to cancelled
    db.prepare(
      'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
    ).run('cancelled', completedAt, prNumber, 'active')
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

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      const affectedIds = transitionTasksToDone(prNumber, 'pr-poller', db)
      updatePrStatusBulk(prNumber, 'merged', 'pr-poller', db, 'done')
      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(
      `[sprint-queries] markTaskDoneByPrNumber failed for PR #${prNumber}: ${msg}`
    )
    return []
  }
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      const affectedIds = transitionTasksToCancelled(prNumber, 'pr-poller', db)
      updatePrStatusBulk(prNumber, 'closed', 'pr-poller', db)
      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(
      `[sprint-queries] markTaskCancelledByPrNumber failed for PR #${prNumber}: ${msg}`
    )
    return []
  }
}

export function listTasksWithOpenPrs(): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS}
         FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'`
      )
      .all() as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] listTasksWithOpenPrs failed: ${msg}`)
    return []
  }
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    const db = getDb()
    db.transaction(() => {
      // Record pr_mergeable_state changes in the audit trail.
      // Read all affected tasks first so we can capture the old value per task.
      const sql = `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE pr_number = ?`
      const affected = db.prepare(sql).all(prNumber) as Array<Record<string, unknown>>

      db.prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?').run(
        mergeableState,
        prNumber
      )

      for (const oldTask of affected) {
        recordTaskChanges(
          oldTask.id as string,
          oldTask,
          { pr_mergeable_state: mergeableState },
          'pr-poller',
          db
        )
      }
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(
      `[sprint-queries] updateTaskMergeableState failed for PR #${prNumber}: ${msg}`
    )
  }
}
