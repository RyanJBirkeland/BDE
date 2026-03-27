/**
 * Sprint task query functions — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import type { Logger } from '../agent-manager/types'

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
 */
function sanitizeTask(row: Record<string, unknown>): SprintTask {
  return {
    ...row,
    depends_on: sanitizeDependsOn(row.depends_on),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review
  } as SprintTask
}

/**
 * Sanitize an array of task rows.
 */
function sanitizeTasks(rows: Record<string, unknown>[]): SprintTask[] {
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
  'max_runtime_ms'
])

export interface QueueStats {
  [key: string]: number
  backlog: number
  queued: number
  active: number
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
  if (key === 'playground_enabled' || key === 'needs_review') {
    return value ? 1 : 0
  }
  if (key === 'prompt' && value == null) {
    return ''
  }
  return value
}

export function getTask(id: string): SprintTask | null {
  try {
    const row = getDb()
      .prepare('SELECT * FROM sprint_tasks WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? sanitizeTask(row) : null
  } catch (err) {
    logger.warn(`[sprint-queries] getTask failed for id=${id}: ${err}`)
    return null
  }
}

export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    if (status) {
      const rows = db
        .prepare(
          'SELECT * FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC'
        )
        .all(status) as Record<string, unknown>[]
      return sanitizeTasks(rows)
    }
    const rows = db
      .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at ASC')
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    logger.warn(`[sprint-queries] listTasks failed: ${err}`)
    return []
  }
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  try {
    const db = getDb()
    const dependsOn = sanitizeDependsOn(input.depends_on)

    const result = db
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name, depends_on, playground_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.playground_enabled ? 1 : 0
      ) as Record<string, unknown> | undefined

    return result ? sanitizeTask(result) : null
  } catch (err) {
    logger.warn(`[sprint-queries] createTask failed: ${err}`)
    return null
  }
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>
): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  try {
    const db = getDb()

    // Fetch current state for change tracking
    const oldTask = getTask(id)
    if (!oldTask) return null

    // Build SET clause with serialized values
    const setClauses: string[] = []
    const values: unknown[] = []
    const auditPatch: Record<string, unknown> = {}

    for (const [key, value] of entries) {
      setClauses.push(`${key} = ?`)
      const serialized = serializeField(key, value)
      values.push(serialized)
      // For audit, store the serialized form for depends_on but original for others
      auditPatch[key] = key === 'depends_on' ? sanitizeDependsOn(value) : value
    }

    values.push(id)

    const result = db
      .prepare(
        `UPDATE sprint_tasks SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`
      )
      .get(...values) as Record<string, unknown> | undefined

    if (!result) return null

    // Record changes for audit trail
    try {
      recordTaskChanges(
        id,
        oldTask as unknown as Record<string, unknown>,
        auditPatch
      )
    } catch (err) {
      logger.warn(`[sprint-queries] Failed to record task changes: ${err}`)
    }

    return sanitizeTask(result)
  } catch (err) {
    logger.warn(`[sprint-queries] updateTask failed for id=${id}: ${err}`)
    return null
  }
}

export function deleteTask(id: string): void {
  try {
    getDb().prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
  } catch (err) {
    logger.warn(`[sprint-queries] deleteTask failed for id=${id}: ${err}`)
  }
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  try {
    const now = new Date().toISOString()
    const result = getDb()
      .prepare(
        `UPDATE sprint_tasks
         SET status = 'active', claimed_by = ?, started_at = ?
         WHERE id = ? AND status = 'queued'
         RETURNING *`
      )
      .get(claimedBy, now, id) as Record<string, unknown> | undefined

    return result ? sanitizeTask(result) : null
  } catch (err) {
    logger.warn(`[sprint-queries] claimTask failed for id=${id}: ${err}`)
    return null
  }
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  try {
    const result = getDb()
      .prepare(
        `UPDATE sprint_tasks
         SET status = 'queued', claimed_by = NULL, started_at = NULL, agent_run_id = NULL
         WHERE id = ? AND status = 'active' AND claimed_by = ?
         RETURNING *`
      )
      .get(id, claimedBy) as Record<string, unknown> | undefined

    return result ? sanitizeTask(result) : null
  } catch (err) {
    logger.warn(`[sprint-queries] releaseTask failed for id=${id}: ${err}`)
    return null
  }
}

export function getQueueStats(): QueueStats {
  const stats: QueueStats = {
    backlog: 0,
    queued: 0,
    active: 0,
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
    logger.warn(`[sprint-queries] getQueueStats failed: ${err}`)
  }

  return stats
}

export function getDoneTodayCount(): number {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = getDb()
      .prepare(
        'SELECT COUNT(*) as count FROM sprint_tasks WHERE status = ? AND completed_at >= ?'
      )
      .get('done', today.toISOString()) as { count: number }

    return result.count
  } catch (err) {
    logger.warn(`[sprint-queries] getDoneTodayCount failed: ${err}`)
    return 0
  }
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected task IDs
      const affected = db
        .prepare('SELECT id FROM sprint_tasks WHERE pr_number = ? AND status = ?')
        .all(prNumber, 'active') as Array<{ id: string }>

      const affectedIds = affected.map((r) => r.id)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()
        // Transition active tasks to done
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('done', completedAt, prNumber, 'active')
      }

      // Set pr_status to merged for done tasks with open PRs
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'merged' WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    logger.warn(`[sprint-queries] failed to mark task done for PR #${prNumber}: ${err}`)
    return []
  }
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected task IDs
      const affected = db
        .prepare('SELECT id FROM sprint_tasks WHERE pr_number = ? AND status = ?')
        .all(prNumber, 'active') as Array<{ id: string }>

      const affectedIds = affected.map((r) => r.id)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()
        // Transition active tasks to cancelled
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('cancelled', completedAt, prNumber, 'active')
      }

      // Set pr_status to closed for done tasks with open PRs
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'closed' WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    logger.warn(
      `[sprint-queries] failed to mark task cancelled for PR #${prNumber}: ${err}`
    )
    return []
  }
}

export function listTasksWithOpenPrs(): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'"
      )
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    logger.warn(`[sprint-queries] listTasksWithOpenPrs failed: ${err}`)
    return []
  }
}

export function updateTaskMergeableState(
  prNumber: number,
  mergeableState: string | null
): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    logger.warn(
      `[sprint-queries] failed to update mergeable_state for PR #${prNumber}: ${err}`
    )
  }
}

export function getActiveTaskCount(): number {
  try {
    const result = getDb()
      .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
      .get() as { count: number }
    return result.count
  } catch (err) {
    // Fail-closed: return MAX to prevent new claims when DB is broken.
    // This is intentional — better to block claims than to over-saturate.
    logger.warn(`[sprint-queries] getActiveTaskCount failed: ${err}`)
    return Infinity
  }
}

export function getQueuedTasks(limit: number): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT * FROM sprint_tasks
         WHERE status = 'queued' AND claimed_by IS NULL
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    logger.warn(`[sprint-queries] getQueuedTasks failed: ${err}`)
    return []
  }
}

export function getOrphanedTasks(claimedBy: string): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?"
      )
      .all(claimedBy) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    logger.warn(`[sprint-queries] getOrphanedTasks failed: ${err}`)
    return []
  }
}

export function clearSprintTaskFk(agentRunId: string): void {
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    logger.warn(
      `[sprint-queries] failed to clear FK for agent_run_id=${agentRunId}: ${err}`
    )
  }
}

export function getHealthCheckTasks(): SprintTask[] {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE status = 'active' AND started_at < ?"
      )
      .all(oneHourAgo) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    logger.warn(`[sprint-queries] getHealthCheckTasks failed: ${err}`)
    return []
  }
}

export function getTasksWithDependencies(): Array<{
  id: string
  depends_on: TaskDependency[] | null
  status: string
}> {
  try {
    const rows = getDb()
      .prepare(
        'SELECT id, depends_on, status FROM sprint_tasks WHERE depends_on IS NOT NULL'
      )
      .all() as Array<{ id: string; depends_on: string; status: string }>

    return rows.map((row) => ({
      ...row,
      depends_on: sanitizeDependsOn(row.depends_on)
    }))
  } catch (err) {
    logger.warn(`[sprint-queries] getTasksWithDependencies failed: ${err}`)
    return []
  }
}
