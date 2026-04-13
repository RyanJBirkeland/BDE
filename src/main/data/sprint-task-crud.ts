/**
 * Sprint task CRUD operations — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 *
 * Extracted from sprint-queries.ts to improve modularity.
 */
import type Database from 'better-sqlite3'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import type { Logger } from '../logger'
import { withRetry } from './sqlite-retry'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { validateTransition } from '../../shared/task-state-machine'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setCrudLogger(l: Logger): void {
  logger = l
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

// F-t3-datalyr-7: Whitelist Map for defense-in-depth column validation
export const COLUMN_MAP = new Map<string, string>(
  Array.from(UPDATE_ALLOWLIST).map((col) => [col, col])
)

// Module-load assertion: COLUMN_MAP must match UPDATE_ALLOWLIST exactly
if (COLUMN_MAP.size !== UPDATE_ALLOWLIST.size) {
  throw new Error('COLUMN_MAP/UPDATE_ALLOWLIST mismatch')
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
 * Sanitize a single task row from SQLite.
 * - Coerces INTEGER 0/1 to boolean for playground_enabled, needs_review
 * - Deserializes depends_on from JSON string
 * - Deserializes tags from JSON string
 */
export function mapRowToTask(row: Record<string, unknown>): SprintTask {
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
export function mapRowsToTasks(rows: Record<string, unknown>[]): SprintTask[] {
  return rows.map(mapRowToTask)
}

/**
 * Serialize a value for SQLite storage:
 * - depends_on: JSON.stringify
 * - booleans: 1/0
 * - null prompt: ''
 */
function serializeFieldForStorage(key: string, value: unknown): unknown {
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

function checkWipLimit(db: Database.Database, maxActive: number): boolean {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
    .get() as { count: number }
  return count < maxActive
}

export function getTask(id: string, db?: Database.Database): SprintTask | null {
  try {
    const conn = db ?? getDb()
    const row = conn
      .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    return row ? mapRowToTask(row) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] getTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    if (status) {
      const rows = db
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC`
        )
        .all(status) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    }
    const rows = db
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks ORDER BY priority ASC, created_at ASC`
      )
      .all() as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] listTasks failed: ${msg}`)
    return []
  }
}

export function listTasksRecent(): SprintTask[] {
  try {
    const db = getDb()
    // F-t3-db-2: Rewrite OR-clause as UNION ALL of two index-able branches.
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
    return mapRowsToTasks(rows)
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] listTasksRecent failed: ${msg}`)
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

    return result ? mapRowToTask(result) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] createTask failed: ${msg}`)
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
  // Reuse createTask instead of duplicating INSERT logic
  const task = createTask({
    title: input.title,
    repo: input.repo,
    spec: input.spec,
    prompt: input.spec, // prompt mirrors spec — keeps the agent's full task message accessible
    status: 'review'
  })

  if (!task) return null

  // Set fields not in the create allowlist (worktree_path, started_at)
  const updated = updateTask(task.id, {
    worktree_path: input.worktreePath,
    started_at: nowIso()
  })

  if (updated) {
    logger.info(
      `[sprint-task-crud] Promoted adhoc work to review task ${updated.id} (branch ${input.branch})`
    )
  }

  return updated
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
          const result = validateTransition(currentStatus, patch.status)
          if (!result.ok) {
            logger.warn(`[sprint-task-crud] ${result.reason} for task ${id}`)
            return null
          }
        }

        // F-t3-model-1: Filter unchanged fields at the caller level.
        const changedEntries = entries.filter(([key, value]) => {
          const serializedNew = serializeFieldForStorage(key, value)
          const oldRaw = (oldTask as unknown as Record<string, unknown>)[key]
          const serializedOld = serializeFieldForStorage(key, oldRaw)
          return serializedNew !== serializedOld
        })

        // No-op: nothing actually changed.
        if (changedEntries.length === 0) {
          return oldTask
        }

        // Build SET clause with serialized values
        const setClauses: string[] = []
        const values: unknown[] = []
        const auditPatch: Record<string, unknown> = {}

        for (const [key, value] of changedEntries) {
          // F-t3-datalyr-7: Whitelist Map replaces regex for defense-in-depth
          const colName = COLUMN_MAP.get(key)
          if (!colName) {
            throw new Error(`Invalid column name: ${key}`)
          }
          setClauses.push(`${colName} = ?`)
          const serialized = serializeFieldForStorage(key, value)
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
             RETURNING ${SPRINT_TASK_COLUMNS}`
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
          logger.warn(`[sprint-task-crud] Failed to record task changes: ${err}`)
          // Re-throw to abort transaction
          throw err
        }

        return mapRowToTask(result)
      })()
    )
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] updateTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function deleteTask(id: string, deletedBy: string = 'unknown'): void {
  try {
    const db = getDb()
    // DL-14 & DL-18: Record deletion in audit trail before removing task
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] deleteTask failed for id=${id}: ${msg}`)
  }
}

export function claimTask(id: string, claimedBy: string, maxActive?: number): SprintTask | null {
  try {
    const db = getDb()
    const now = nowIso()

    // Atomic WIP check + claim in single transaction with retry on SQLITE_BUSY
    const result = withRetry(() =>
      db.transaction(() => {
        // Optional WIP limit enforcement
        if (maxActive !== undefined && !checkWipLimit(db, maxActive)) {
          return null
        }

        // DL-13 & DL-18: Record audit trail before update
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        const updated = db
          .prepare(
            `UPDATE sprint_tasks
             SET status = 'active', claimed_by = ?, started_at = ?
             WHERE id = ? AND status = 'queued'
             RETURNING ${SPRINT_TASK_COLUMNS}`
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

    return result ? mapRowToTask(result) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] claimTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  try {
    const db = getDb()
    // DL-13 & DL-18: Record audit trail for release
    return db.transaction(() => {
      const oldTask = getTask(id, db)
      if (!oldTask) return null

      const result = db
        .prepare(
          `UPDATE sprint_tasks
           SET status = 'queued', claimed_by = NULL, started_at = NULL, agent_run_id = NULL
           WHERE id = ? AND status = 'active' AND claimed_by = ?
           RETURNING ${SPRINT_TASK_COLUMNS}`
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
        return mapRowToTask(result)
      }

      return null
    })()
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] releaseTask failed for id=${id}: ${msg}`)
    return null
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

export function getOrphanedTasks(claimedBy: string): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS}
         FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?`
      )
      .all(claimedBy) as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-task-crud] getOrphanedTasks failed: ${msg}`)
    return []
  }
}

export function clearSprintTaskFk(agentRunId: string): void {
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(
      `[sprint-task-crud] clearSprintTaskFk failed for agent_run_id=${agentRunId}: ${msg}`
    )
  }
}
