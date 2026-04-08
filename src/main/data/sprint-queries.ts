/**
 * Sprint task query functions — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type Database from 'better-sqlite3'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { isValidTransition } from '../../shared/task-transitions'
import { getDb } from '../db'
import { recordTaskChanges, recordTaskChangesBulk } from './task-changes'
import type { Logger } from '../agent-manager/types'
import { withRetry } from './sqlite-retry'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}

/**
 * Sanitize a single task row from SQLite.
 * - Coerces INTEGER 0/1 to boolean for playground_enabled, needs_review
 * - Deserializes depends_on from JSON string
 * - Deserializes tags from JSON string
 */
export function sanitizeTask(row: Record<string, unknown>): SprintTask {
  let revisionFeedback: unknown = row.revision_feedback
  if (typeof revisionFeedback === 'string') {
    try {
      revisionFeedback = JSON.parse(revisionFeedback)
    } catch {
      revisionFeedback = null
    }
  }
  if (!Array.isArray(revisionFeedback)) revisionFeedback = null
  return {
    ...row,
    depends_on: sanitizeDependsOn(row.depends_on),
    tags: sanitizeTags(row.tags),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review,
    revision_feedback: revisionFeedback
  } as SprintTask
}

/**
 * Sanitize an array of task rows.
 */
export function sanitizeTasks(rows: Record<string, unknown>[]): SprintTask[] {
  return rows.map(sanitizeTask)
}

// --- Field allowlist for updates ---

export const UPDATE_ALLOWLIST = new Set([
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'spec',
  'notes',
  'pr_url',
  'pr_number',
  'pr_status',
  'pr_mergeable_state',
  'agent_run_id',
  'retry_count',
  'fast_fail_count',
  'started_at',
  'completed_at',
  'template_name',
  'claimed_by',
  'depends_on',
  'playground_enabled',
  'needs_review',
  'max_runtime_ms',
  'spec_type',
  'worktree_path',
  'session_id',
  'next_eligible_at',
  'model',
  'tags',
  'retry_context',
  'failure_reason',
  'max_cost_usd',
  'partial_diff',
  'group_id',
  'duration_ms',
  'cross_repo_contract',
  'revision_feedback',
  'review_diff_snapshot'
])

export interface QueueStats {
  [key: string]: number
  backlog: number
  queued: number
  active: number
  review: number
  done: number
  failed: number
  cancelled: number
  error: number
  blocked: number
}

export interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
  spec?: string
  priority?: number
  status?: string
  template_name?: string
  depends_on?: Array<{ id: string; type: 'hard' | 'soft' }> | null
  playground_enabled?: boolean
  model?: string
  tags?: string[] | null
  group_id?: string | null
  cross_repo_contract?: string | null
}

/**
 * Serialize a value for SQLite storage:
 * - depends_on: JSON.stringify
 * - booleans: 1/0
 * - null prompt: ''
 */
function serializeField(key: string, value: unknown): unknown {
  if (key === 'depends_on') {
    const sanitized = sanitizeDependsOn(value)
    return sanitized ? JSON.stringify(sanitized) : null
  }
  if (key === 'tags') {
    const sanitized = sanitizeTags(value)
    return sanitized ? JSON.stringify(sanitized) : null
  }
  if (key === 'revision_feedback') {
    if (value == null) return null
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }
  if (key === 'playground_enabled' || key === 'needs_review') {
    return value ? 1 : 0
  }
  if (key === 'prompt' && value == null) {
    return ''
  }
  return value
}

export function getTask(id: string, db?: Database.Database): SprintTask | null {
  try {
    const conn = db ?? getDb()
    const row = conn
      .prepare(
        `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
         pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
         retry_count, fast_fail_count, started_at, completed_at, claimed_by,
         template_name, playground_enabled, needs_review, max_runtime_ms,
         spec_type, created_at, updated_at, worktree_path, session_id,
         next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
         partial_diff, assigned_reviewer, tags, sprint_id, group_id,
         revision_feedback, review_diff_snapshot
         FROM sprint_tasks WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? sanitizeTask(row) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    const columnList = `id, title, prompt, repo, status, priority, depends_on, spec, notes,
      pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
      retry_count, fast_fail_count, started_at, completed_at, claimed_by,
      template_name, playground_enabled, needs_review, max_runtime_ms,
      spec_type, created_at, updated_at, worktree_path, session_id,
      next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
      partial_diff, assigned_reviewer, tags, sprint_id, group_id,
      revision_feedback, review_diff_snapshot`
    if (status) {
      const rows = db
        .prepare(
          `SELECT ${columnList} FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC`
        )
        .all(status) as Record<string, unknown>[]
      return sanitizeTasks(rows)
    }
    const rows = db
      .prepare(`SELECT ${columnList} FROM sprint_tasks ORDER BY priority ASC, created_at ASC`)
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] listTasks failed: ${msg}`)
    return []
  }
}

export function listTasksRecent(): SprintTask[] {
  try {
    const db = getDb()
    // F-t3-db-2: Rewrite OR-clause as UNION ALL of two index-able branches.
    // The original `WHERE status NOT IN (...) OR completed_at >= ...` forced
    // a full SCAN because OR across columns prevents single-index use. The
    // UNION ALL form lets each branch use idx_sprint_tasks_status:
    //   1) active set: status IN (5 active statuses)
    //   2) recent terminal set: status IN (4 terminal) AND completed_at recent
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM sprint_tasks
             WHERE status IN ('backlog','queued','blocked','active','review')
           UNION ALL
           SELECT * FROM sprint_tasks
             WHERE status IN ('done','cancelled','failed','error')
               AND completed_at >= datetime('now', '-7 days')
         )
         ORDER BY priority ASC, created_at ASC`
      )
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] listTasksRecent failed: ${msg}`)
    return []
  }
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  try {
    const db = getDb()
    const dependsOn = sanitizeDependsOn(input.depends_on)
    const tags = sanitizeTags(input.tags)

    const result = db
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name, depends_on, playground_enabled, model, tags, group_id, cross_repo_contract)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .get(
        input.title,
        input.repo,
        input.prompt ?? input.spec ?? input.title,
        input.spec ?? null,
        input.notes ?? null,
        input.priority ?? 0,
        input.status ?? 'backlog',
        input.template_name ?? null,
        dependsOn ? JSON.stringify(dependsOn) : null,
        input.playground_enabled ? 1 : 0,
        input.model ?? null,
        tags ? JSON.stringify(tags) : null,
        input.group_id ?? null,
        input.cross_repo_contract ?? null
      ) as Record<string, unknown> | undefined

    return result ? sanitizeTask(result) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] createTask failed: ${msg}`)
    return null
  }
}

/**
 * Create a sprint task in `review` status directly, populated from a completed
 * adhoc agent's worktree. Bypasses the normal `backlog → queued → active → review`
 * state machine because the work is already done — the agent committed it locally
 * and the user is explicitly promoting it for review.
 *
 * Used by the `agents:promoteToReview` IPC handler. Do not call from anywhere
 * that should respect the standard task lifecycle.
 */
export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): SprintTask | null {
  try {
    const db = getDb()
    const result = db
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, status, worktree_path, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'review', ?, datetime('now'), NULL)
         RETURNING *`
      )
      .get(
        input.title,
        input.repo,
        input.spec, // prompt mirrors spec — keeps the agent's full task message accessible
        input.spec,
        input.worktreePath
      ) as Record<string, unknown> | undefined

    if (!result) return null

    const task = sanitizeTask(result)
    logger.info(
      `[sprint-queries] Promoted adhoc work to review task ${task.id} (branch ${input.branch})`
    )
    return task
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] createReviewTaskFromAdhoc failed: ${msg}`)
    return null
  }
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  try {
    const db = getDb()

    // Wrap read, update, and audit in a single transaction with retry on SQLITE_BUSY
    return withRetry(() =>
      db.transaction(() => {
        // Fetch current state for change tracking
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        // Enforce status transition state machine
        if (patch.status && typeof patch.status === 'string') {
          const currentStatus = oldTask.status as string
          if (!isValidTransition(currentStatus, patch.status)) {
            logger.warn(
              `[sprint-queries] Invalid status transition: ${currentStatus} → ${patch.status} for task ${id}`
            )
            return null
          }
        }

        // F-t3-model-1: Filter unchanged fields at the caller level. Reduces
        // write amplification on both sprint_tasks (no UPDATE) and task_changes
        // (no audit row). Defense-in-depth — recordTaskChanges also skips
        // unchanged values, but filtering here also avoids the SQL UPDATE.
        const changedEntries = entries.filter(([key, value]) => {
          const serializedNew = serializeField(key, value)
          const oldRaw = (oldTask as unknown as Record<string, unknown>)[key]
          const serializedOld = serializeField(key, oldRaw)
          return serializedNew !== serializedOld
        })

        // No-op: nothing actually changed. Return the existing task without
        // touching sprint_tasks or task_changes.
        if (changedEntries.length === 0) {
          return oldTask
        }

        // Build SET clause with serialized values
        const setClauses: string[] = []
        const values: unknown[] = []
        const auditPatch: Record<string, unknown> = {}

        for (const [key, value] of changedEntries) {
          // QA-18: Defense-in-depth regex assertion for SQL column names
          if (!/^[a-z_]+$/.test(key)) {
            throw new Error(`Invalid column name: ${key}`)
          }
          setClauses.push(`${key} = ?`)
          const serialized = serializeField(key, value)
          values.push(serialized)
          // For audit, store the sanitized form for depends_on/tags but original for others
          if (key === 'depends_on') {
            auditPatch[key] = sanitizeDependsOn(value)
          } else if (key === 'tags') {
            auditPatch[key] = sanitizeTags(value)
          } else {
            auditPatch[key] = value
          }
        }

        values.push(id)

        const result = db
          .prepare(
            `UPDATE sprint_tasks SET ${setClauses.join(', ')} WHERE id = ?
             RETURNING id, title, prompt, repo, status, priority, depends_on, spec, notes,
             pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
             retry_count, fast_fail_count, started_at, completed_at, claimed_by,
             template_name, playground_enabled, needs_review, max_runtime_ms,
             spec_type, created_at, updated_at, worktree_path, session_id,
             next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
             partial_diff, tags, group_id, sprint_id, review_diff_snapshot`
          )
          .get(...values) as Record<string, unknown> | undefined

        if (!result) return null

        // Record changes for audit trail (within transaction)
        try {
          recordTaskChanges(
            id,
            oldTask as unknown as Record<string, unknown>,
            auditPatch,
            'unknown',
            db
          )
        } catch (err) {
          logger.warn(`[sprint-queries] Failed to record task changes: ${err}`)
          // Re-throw to abort transaction
          throw err
        }

        return sanitizeTask(result)
      })()
    )
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] updateTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function deleteTask(id: string, deletedBy: string = 'unknown'): void {
  try {
    const db = getDb()
    // DL-14 & DL-18: Record deletion in audit trail before removing task (pass db for consistency)
    db.transaction(() => {
      const task = getTask(id, db)
      if (task) {
        // Record deletion event with task snapshot
        db.prepare(
          'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)'
        ).run(id, '_deleted', JSON.stringify(task), null, deletedBy)
      }
      // Delete task and orphaned audit records
      db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] deleteTask failed for id=${id}: ${msg}`)
  }
}

export function claimTask(id: string, claimedBy: string, maxActive?: number): SprintTask | null {
  try {
    const db = getDb()
    const now = new Date().toISOString()

    if (maxActive !== undefined) {
      // Atomic WIP check — single transaction prevents TOCTOU race, with retry on SQLITE_BUSY
      const result = withRetry(() =>
        db.transaction(() => {
          const { count } = db
            .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
            .get() as { count: number }
          if (count >= maxActive) return null

          // DL-13 & DL-18: Record audit trail before update (pass db for consistency)
          const oldTask = getTask(id, db)
          if (!oldTask) return null

          const updated = db
            .prepare(
              `UPDATE sprint_tasks
               SET status = 'active', claimed_by = ?, started_at = ?
               WHERE id = ? AND status = 'queued'
               RETURNING id, title, prompt, repo, status, priority, depends_on, spec, notes,
               pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
               retry_count, fast_fail_count, started_at, completed_at, claimed_by,
               template_name, playground_enabled, needs_review, max_runtime_ms,
               spec_type, created_at, updated_at, worktree_path, session_id,
               next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
               partial_diff, tags, group_id, sprint_id, review_diff_snapshot`
            )
            .get(claimedBy, now, id) as Record<string, unknown> | undefined

          if (updated) {
            recordTaskChanges(
              id,
              oldTask as unknown as Record<string, unknown>,
              { status: 'active', claimed_by: claimedBy, started_at: now },
              claimedBy,
              db
            )
          }

          return updated
        })()
      )

      return result ? sanitizeTask(result) : null
    }

    // No WIP limit — original behavior with audit trail, with retry on SQLITE_BUSY
    return withRetry(() =>
      db.transaction(() => {
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        const result = db
          .prepare(
            `UPDATE sprint_tasks
             SET status = 'active', claimed_by = ?, started_at = ?
             WHERE id = ? AND status = 'queued'
             RETURNING id, title, prompt, repo, status, priority, depends_on, spec, notes,
             pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
             retry_count, fast_fail_count, started_at, completed_at, claimed_by,
             template_name, playground_enabled, needs_review, max_runtime_ms,
             spec_type, created_at, updated_at, worktree_path, session_id,
             next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
             partial_diff, tags, group_id, sprint_id, review_diff_snapshot`
          )
          .get(claimedBy, now, id) as Record<string, unknown> | undefined

        if (result) {
          recordTaskChanges(
            id,
            oldTask as unknown as Record<string, unknown>,
            { status: 'active', claimed_by: claimedBy, started_at: now },
            claimedBy,
            db
          )
          return sanitizeTask(result)
        }

        return null
      })()
    )
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] claimTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  try {
    const db = getDb()
    // DL-13 & DL-18: Record audit trail for release (pass db for consistency)
    return db.transaction(() => {
      const oldTask = getTask(id, db)
      if (!oldTask) return null

      const result = db
        .prepare(
          `UPDATE sprint_tasks
           SET status = 'queued', claimed_by = NULL, started_at = NULL, agent_run_id = NULL
           WHERE id = ? AND status = 'active' AND claimed_by = ?
           RETURNING id, title, prompt, repo, status, priority, depends_on, spec, notes,
           pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
           retry_count, fast_fail_count, started_at, completed_at, claimed_by,
           template_name, playground_enabled, needs_review, max_runtime_ms,
           spec_type, created_at, updated_at, worktree_path, session_id,
           next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
           partial_diff, tags, group_id, sprint_id, review_diff_snapshot`
        )
        .get(id, claimedBy) as Record<string, unknown> | undefined

      if (result) {
        recordTaskChanges(
          id,
          oldTask as unknown as Record<string, unknown>,
          { status: 'queued', claimed_by: null, started_at: null, agent_run_id: null },
          claimedBy,
          db
        )
        return sanitizeTask(result)
      }

      return null
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] releaseTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function getQueueStats(): QueueStats {
  const stats: QueueStats = {
    backlog: 0,
    queued: 0,
    active: 0,
    review: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    error: 0,
    blocked: 0
  }

  try {
    const rows = getDb()
      .prepare('SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status')
      .all() as Array<{ status: string; count: number }>

    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof QueueStats] = row.count
      }
    }
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getQueueStats failed: ${msg}`)
  }

  return stats
}

export function getDoneTodayCount(): number {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = getDb()
      .prepare('SELECT COUNT(*) as count FROM sprint_tasks WHERE status = ? AND completed_at >= ?')
      .get('done', today.toISOString()) as { count: number }

    return result.count
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getDoneTodayCount failed: ${msg}`)
    return 0
  }
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected tasks with full state for audit trail
      const affected = db
        .prepare(
          `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
           pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
           retry_count, fast_fail_count, started_at, completed_at, claimed_by,
           template_name, playground_enabled, needs_review, max_runtime_ms,
           spec_type, created_at, updated_at, worktree_path, session_id,
           next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
           partial_diff, tags, group_id, sprint_id, review_diff_snapshot
           FROM sprint_tasks WHERE pr_number = ? AND status = ?`
        )
        .all(prNumber, 'active') as Array<Record<string, unknown>>

      const affectedIds = affected.map((r) => r.id as string)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()

        // F-t3-db-4: Bulk audit trail (single prepared INSERT statement reused
        // across all affected tasks instead of one prepared statement per call)
        try {
          recordTaskChangesBulk(
            affected.map((oldTask) => ({
              taskId: oldTask.id as string,
              oldTask,
              newPatch: { status: 'done', completed_at: completedAt }
            })),
            'pr-poller',
            db
          )
        } catch (err) {
          logger.warn(`[sprint-queries] Failed to record bulk changes: ${err}`)
        }

        // Transition active tasks to done
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('done', completedAt, prNumber, 'active')
      }

      // Get tasks where pr_status will change for audit
      const prStatusAffected = db
        .prepare(
          `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
           pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
           retry_count, fast_fail_count, started_at, completed_at, claimed_by,
           template_name, playground_enabled, needs_review, max_runtime_ms,
           spec_type, created_at, updated_at, worktree_path, session_id,
           next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
           partial_diff, tags, group_id, sprint_id, review_diff_snapshot
           FROM sprint_tasks WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'`
        )
        .all(prNumber) as Array<Record<string, unknown>>

      // F-t3-db-4: Bulk audit trail for pr_status changes
      try {
        recordTaskChangesBulk(
          prStatusAffected.map((oldTask) => ({
            taskId: oldTask.id as string,
            oldTask,
            newPatch: { pr_status: 'merged' }
          })),
          'pr-poller',
          db
        )
      } catch (err) {
        logger.warn(`[sprint-queries] Failed to record bulk pr_status changes: ${err}`)
      }

      // Set pr_status to merged for done tasks with open PRs
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'merged' WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] markTaskDoneByPrNumber failed for PR #${prNumber}: ${msg}`)
    return []
  }
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected tasks with full state for audit trail
      const affected = db
        .prepare(
          `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
           pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
           retry_count, fast_fail_count, started_at, completed_at, claimed_by,
           template_name, playground_enabled, needs_review, max_runtime_ms,
           spec_type, created_at, updated_at, worktree_path, session_id,
           next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
           partial_diff, tags, group_id, sprint_id, review_diff_snapshot
           FROM sprint_tasks WHERE pr_number = ? AND status = ?`
        )
        .all(prNumber, 'active') as Array<Record<string, unknown>>

      const affectedIds = affected.map((r) => r.id as string)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()

        // F-t3-db-4: Bulk audit trail
        try {
          recordTaskChangesBulk(
            affected.map((oldTask) => ({
              taskId: oldTask.id as string,
              oldTask,
              newPatch: { status: 'cancelled', completed_at: completedAt }
            })),
            'pr-poller',
            db
          )
        } catch (err) {
          logger.warn(`[sprint-queries] Failed to record bulk changes: ${err}`)
        }

        // Transition active tasks to cancelled
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('cancelled', completedAt, prNumber, 'active')
      }

      // Get ALL tasks where pr_status will change for audit (any status, not just done)
      const prStatusAffected = db
        .prepare(
          `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
           pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
           retry_count, fast_fail_count, started_at, completed_at, claimed_by,
           template_name, playground_enabled, needs_review, max_runtime_ms,
           spec_type, created_at, updated_at, worktree_path, session_id,
           next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
           partial_diff, tags, group_id, sprint_id, review_diff_snapshot
           FROM sprint_tasks WHERE pr_number = ? AND pr_status = 'open'`
        )
        .all(prNumber) as Array<Record<string, unknown>>

      // F-t3-db-4: Bulk audit trail for pr_status changes
      try {
        recordTaskChangesBulk(
          prStatusAffected.map((oldTask) => ({
            taskId: oldTask.id as string,
            oldTask,
            newPatch: { pr_status: 'closed' }
          })),
          'pr-poller',
          db
        )
      } catch (err) {
        logger.warn(`[sprint-queries] Failed to record bulk pr_status changes: ${err}`)
      }

      // Set pr_status to closed for ALL tasks with this PR number that still show open
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'closed' WHERE pr_number = ? AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] markTaskCancelledByPrNumber failed for PR #${prNumber}: ${msg}`)
    return []
  }
}

export function listTasksWithOpenPrs(): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
         pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
         retry_count, fast_fail_count, started_at, completed_at, claimed_by,
         template_name, playground_enabled, needs_review, max_runtime_ms,
         spec_type, created_at, updated_at, worktree_path, session_id,
         next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
         partial_diff, assigned_reviewer, tags, sprint_id, group_id, review_diff_snapshot
         FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'`
      )
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] listTasksWithOpenPrs failed: ${msg}`)
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
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] updateTaskMergeableState failed for PR #${prNumber}: ${msg}`)
  }
}

export function getActiveTaskCount(): number {
  try {
    const result = getDb()
      .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
      .get() as { count: number }
    return result.count
  } catch (err) {
    // DL-17: Standardize error message format
    // Fail-closed: return MAX to prevent new claims when DB is broken.
    // This is intentional — better to block claims than to over-saturate.
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getActiveTaskCount failed: ${msg}`)
    return Infinity
  }
}

export function getQueuedTasks(limit: number): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
         pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
         retry_count, fast_fail_count, started_at, completed_at, claimed_by,
         template_name, playground_enabled, needs_review, max_runtime_ms,
         spec_type, created_at, updated_at, worktree_path, session_id,
         next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
         partial_diff, assigned_reviewer, tags, sprint_id, group_id, review_diff_snapshot
         FROM sprint_tasks
         WHERE status = 'queued' AND claimed_by IS NULL AND (next_eligible_at IS NULL OR next_eligible_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getQueuedTasks failed: ${msg}`)
    return []
  }
}

export function getOrphanedTasks(claimedBy: string): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
         pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
         retry_count, fast_fail_count, started_at, completed_at, claimed_by,
         template_name, playground_enabled, needs_review, max_runtime_ms,
         spec_type, created_at, updated_at, worktree_path, session_id,
         next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
         partial_diff, assigned_reviewer, tags, sprint_id, group_id, review_diff_snapshot
         FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?`
      )
      .all(claimedBy) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getOrphanedTasks failed: ${msg}`)
    return []
  }
}

export function clearSprintTaskFk(agentRunId: string): void {
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] clearSprintTaskFk failed for agent_run_id=${agentRunId}: ${msg}`)
  }
}

export function getHealthCheckTasks(): SprintTask[] {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = getDb()
      .prepare(
        `SELECT id, title, prompt, repo, status, priority, depends_on, spec, notes,
         pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
         retry_count, fast_fail_count, started_at, completed_at, claimed_by,
         template_name, playground_enabled, needs_review, max_runtime_ms,
         spec_type, created_at, updated_at, worktree_path, session_id,
         next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
         partial_diff, assigned_reviewer, tags, sprint_id, group_id, review_diff_snapshot
         FROM sprint_tasks WHERE status = 'active' AND started_at < ?`
      )
      .all(oneHourAgo) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getHealthCheckTasks failed: ${msg}`)
    return []
  }
}

export function getAllTaskIds(): Set<string> {
  // No try/catch: DB errors must propagate so callers get a 500,
  // not a misleading 400 "task IDs do not exist" from an empty Set.
  const rows = getDb().prepare('SELECT id FROM sprint_tasks').all() as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function getTasksWithDependencies(): Array<{
  id: string
  depends_on: TaskDependency[] | null
  status: string
}> {
  // No try/catch: DB errors must propagate (same rationale as getAllTaskIds).
  // Query ALL tasks, not just those with depends_on — cycle detection needs
  // the full graph to catch cycles involving tasks receiving their first dependency.
  const rows = getDb().prepare('SELECT id, depends_on, status FROM sprint_tasks').all() as Array<{
    id: string
    depends_on: string | null
    status: string
  }>

  return rows.map((row) => ({
    ...row,
    depends_on: row.depends_on ? sanitizeDependsOn(row.depends_on) : null
  }))
}

export interface FailureReasonBreakdown {
  reason: string
  count: number
}

export function getFailureReasonBreakdown(): FailureReasonBreakdown[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT
          COALESCE(failure_reason, 'Unknown') as reason,
          COUNT(*) as count
         FROM sprint_tasks
         WHERE status IN ('failed', 'error')
         GROUP BY failure_reason
         ORDER BY count DESC`
      )
      .all() as Array<{ reason: string; count: number }>

    return rows
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getFailureReasonBreakdown failed: ${msg}`)
    return []
  }
}

export interface TaskRuntimeStats {
  avgDurationMs: number | null
  minDurationMs: number | null
  maxDurationMs: number | null
  tasksWithDuration: number
}

/**
 * Get runtime statistics from completed tasks with duration_ms populated.
 * Returns aggregate stats (avg, min, max) for terminal tasks.
 */
export function getTaskRuntimeStats(): TaskRuntimeStats {
  try {
    const result = getDb()
      .prepare(
        `SELECT
          AVG(duration_ms) as avgDurationMs,
          MIN(duration_ms) as minDurationMs,
          MAX(duration_ms) as maxDurationMs,
          COUNT(*) as tasksWithDuration
         FROM sprint_tasks
         WHERE duration_ms IS NOT NULL
           AND status IN ('done', 'failed', 'review')`
      )
      .get() as {
      avgDurationMs: number | null
      minDurationMs: number | null
      maxDurationMs: number | null
      tasksWithDuration: number
    }

    return {
      avgDurationMs: result.avgDurationMs,
      minDurationMs: result.minDurationMs,
      maxDurationMs: result.maxDurationMs,
      tasksWithDuration: result.tasksWithDuration
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getTaskRuntimeStats failed: ${msg}`)
    return {
      avgDurationMs: null,
      minDurationMs: null,
      maxDurationMs: null,
      tasksWithDuration: 0
    }
  }
}

export interface SpecTypeSuccessRate {
  spec_type: string | null
  done: number
  total: number
  success_rate: number
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  try {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT
           spec_type,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
           COUNT(*) as total
         FROM sprint_tasks
         WHERE status IN ('done', 'failed', 'error', 'cancelled')
         GROUP BY spec_type`
      )
      .all() as Array<{ spec_type: string | null; done: number; total: number }>

    return rows.map((row) => ({
      spec_type: row.spec_type ?? null,
      done: row.done,
      total: row.total,
      success_rate: row.total > 0 ? row.done / row.total : 0
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getSuccessRateBySpecType failed: ${msg}`)
    return []
  }
}

export interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

/**
 * Get daily success rates for the last N days with gap-filling.
 * Success rate = done / (done + failed + error) per day.
 * Days with no terminal tasks return null success rate but are included in results.
 */
export function getDailySuccessRate(days: number = 14): DailySuccessRate[] {
  try {
    const db = getDb()
    // Generate continuous date range for last N days, then LEFT JOIN with task stats
    const rows = db
      .prepare(
        `WITH RECURSIVE dates(date) AS (
          SELECT date('now', '-${days - 1} days')
          UNION ALL
          SELECT date(date, '+1 day')
          FROM dates
          WHERE date < date('now')
        ),
        daily_stats AS (
          SELECT
            date(completed_at) as date,
            COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
            COUNT(CASE WHEN status IN ('failed', 'error') THEN 1 END) as failed
          FROM sprint_tasks
          WHERE completed_at IS NOT NULL
            AND date(completed_at) >= date('now', '-${days} days')
          GROUP BY date(completed_at)
        )
        SELECT
          dates.date,
          COALESCE(daily_stats.done, 0) as done,
          COALESCE(daily_stats.failed, 0) as failed
        FROM dates
        LEFT JOIN daily_stats ON dates.date = daily_stats.date
        ORDER BY dates.date ASC`
      )
      .all() as Array<{ date: string; done: number; failed: number }>

    return rows.map((row) => {
      const total = row.done + row.failed
      return {
        date: row.date,
        successRate: total > 0 ? (row.done / total) * 100 : null,
        doneCount: row.done,
        failedCount: row.failed
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getDailySuccessRate failed: ${msg}`)
    return []
  }
}

/**
 * How many days to retain `review_diff_snapshot` blobs for tasks in terminal
 * states. Snapshots are only useful while a task is in `review` — once
 * merged/discarded their value drops sharply, but at ~500KB per row they can
 * cause significant database bloat over time. Tunable here.
 */
export const DIFF_SNAPSHOT_RETENTION_DAYS = 30

/**
 * Null out `review_diff_snapshot` for tasks in terminal states older than
 * `retentionDays` days. Returns the number of rows updated.
 *
 * Snapshots on tasks still in `review` (or any non-terminal state) are
 * preserved unconditionally — the cleanup only targets done / cancelled /
 * failed / error tasks where the worktree is long gone and the snapshot is
 * unlikely to be useful.
 */
export function pruneOldDiffSnapshots(
  retentionDays: number = DIFF_SNAPSHOT_RETENTION_DAYS,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = conn
    .prepare(
      `UPDATE sprint_tasks
       SET review_diff_snapshot = NULL
       WHERE review_diff_snapshot IS NOT NULL
         AND status IN ('done', 'cancelled', 'failed', 'error')
         AND updated_at < ?`
    )
    .run(cutoff)
  return result.changes
}
