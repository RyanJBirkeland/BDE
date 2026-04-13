/**
 * Sprint task PR status synchronization with GitHub.
 * Extracted from sprint-queries.ts to improve modularity.
 */
import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import { getDb } from '../db'
import { recordTaskChangesBulk } from './task-changes'
import type { Logger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-crud'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setPrSyncLogger(l: Logger): void {
  logger = l
}

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

    // F-t3-db-4: Bulk audit trail
    try {
      recordTaskChangesBulk(
        affected.map((oldTask) => ({
          taskId: oldTask.id as string,
          oldTask,
          newPatch: { status: 'done', completed_at: completedAt }
        })),
        changedBy,
        db
      )
    } catch (err) {
      logger.warn(`[sprint-pr-sync] Failed to record bulk changes: ${err}`)
    }

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

    // F-t3-db-4: Bulk audit trail
    try {
      recordTaskChangesBulk(
        affected.map((oldTask) => ({
          taskId: oldTask.id as string,
          oldTask,
          newPatch: { status: 'cancelled', completed_at: completedAt }
        })),
        changedBy,
        db
      )
    } catch (err) {
      logger.warn(`[sprint-pr-sync] Failed to record bulk changes: ${err}`)
    }

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

  // F-t3-db-4: Bulk audit trail for pr_status changes
  try {
    recordTaskChangesBulk(
      prStatusAffected.map((oldTask) => ({
        taskId: oldTask.id as string,
        oldTask,
        newPatch: { pr_status: newStatus }
      })),
      changedBy,
      db
    )
  } catch (err) {
    logger.warn(`[sprint-pr-sync] Failed to record bulk pr_status changes: ${err}`)
  }

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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-pr-sync] markTaskDoneByPrNumber failed for PR #${prNumber}: ${msg}`)
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-pr-sync] markTaskCancelledByPrNumber failed for PR #${prNumber}: ${msg}`)
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-pr-sync] listTasksWithOpenPrs failed: ${msg}`)
    return []
  }
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-pr-sync] updateTaskMergeableState failed for PR #${prNumber}: ${msg}`)
  }
}
