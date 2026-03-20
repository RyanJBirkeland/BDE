/**
 * Sprint task query functions — extracted from handlers/sprint-local.ts.
 * All functions take `db: Database.Database` as first parameter for testability.
 */
import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'

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
}

export function getTask(db: Database.Database, id: string): SprintTask | null {
  return db.prepare('SELECT * FROM sprint_tasks WHERE id = ?').get(id) as SprintTask | null
}

export function listTasks(db: Database.Database, status?: string): SprintTask[] {
  if (status) {
    return db
      .prepare('SELECT * FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC')
      .all(status) as SprintTask[]
  }
  return db
    .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at ASC')
    .all() as SprintTask[]
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
}

export function createTask(db: Database.Database, input: CreateTaskInput): SprintTask {
  return db
    .prepare(
      `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name)
       VALUES (@title, @repo, @prompt, @spec, @notes, @priority, @status, @template_name)
       RETURNING *`
    )
    .get({
      title: input.title,
      repo: input.repo,
      prompt: input.prompt ?? input.spec ?? input.title,
      spec: input.spec ?? null,
      notes: input.notes ?? null,
      priority: input.priority ?? 0,
      status: input.status ?? 'backlog',
      template_name: input.template_name ?? null,
    }) as SprintTask
}

export function updateTask(
  db: Database.Database,
  id: string,
  patch: Record<string, unknown>
): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
  const values = entries.map(([, v]) => v)

  const row = db
    .prepare(`UPDATE sprint_tasks SET ${setClauses} WHERE id = ? RETURNING *`)
    .get(...values, id) as SprintTask | undefined

  if (row) {
    // Re-fetch for correct updated_at (trigger fires after RETURNING)
    return getTask(db, id)!
  }
  return null
}

export function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
}

export function claimTask(
  db: Database.Database,
  id: string,
  claimedBy: string
): SprintTask | null {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `UPDATE sprint_tasks
       SET status = 'active', claimed_by = ?, started_at = ?
       WHERE id = ? AND status = 'queued'
       RETURNING *`
    )
    .get(claimedBy, now, id) as SprintTask | undefined

  if (result) {
    // Re-fetch to get the correct updated_at (trigger fires after RETURNING)
    return getTask(db, id)!
  }
  return null
}

export function releaseTask(db: Database.Database, id: string): SprintTask | null {
  const result = db
    .prepare(
      `UPDATE sprint_tasks
       SET status = 'queued', claimed_by = NULL, started_at = NULL, agent_run_id = NULL
       WHERE id = ? AND status = 'active'
       RETURNING *`
    )
    .get(id) as SprintTask | undefined

  if (result) {
    return getTask(db, id)!
  }
  return null
}

export function getQueueStats(db: Database.Database): QueueStats {
  const rows = db
    .prepare('SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status')
    .all() as { status: string; count: number }[]

  const stats: QueueStats = {
    backlog: 0,
    queued: 0,
    active: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    error: 0,
  }
  for (const row of rows) {
    if (row.status in stats) {
      stats[row.status as keyof QueueStats] = row.count
    }
  }
  return stats
}

export function getDoneTodayCount(db: Database.Database): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'done' AND completed_at >= ?"
    )
    .get(today.toISOString()) as { count: number }
  return row.count
}

export function markTaskDoneByPrNumber(db: Database.Database, prNumber: number): void {
  try {
    const completedAt = new Date().toISOString()
    // Transition active tasks to done
    db.prepare(
      "UPDATE sprint_tasks SET status='done', completed_at=? WHERE pr_number=? AND status='active'"
    ).run(completedAt, prNumber)
    // Also update pr_status to merged for tasks already marked done (by task runner)
    db.prepare(
      "UPDATE sprint_tasks SET pr_status='merged' WHERE pr_number=? AND status='done' AND pr_status='open'"
    ).run(prNumber)
  } catch (err) {
    console.warn(`[sprint-queries] failed to mark task done for PR #${prNumber}:`, err)
  }
}

export function markTaskCancelledByPrNumber(db: Database.Database, prNumber: number): void {
  try {
    // Transition active tasks to cancelled
    db.prepare(
      "UPDATE sprint_tasks SET status='cancelled', completed_at=? WHERE pr_number=? AND status='active'"
    ).run(new Date().toISOString(), prNumber)
    // Also update pr_status to closed for tasks already marked done
    db.prepare(
      "UPDATE sprint_tasks SET pr_status='closed' WHERE pr_number=? AND status='done' AND pr_status='open'"
    ).run(prNumber)
  } catch (err) {
    console.warn(`[sprint-queries] failed to mark task cancelled for PR #${prNumber}:`, err)
  }
}

export function listTasksWithOpenPrs(db: Database.Database): SprintTask[] {
  return db
    .prepare(
      "SELECT * FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'"
    )
    .all() as SprintTask[]
}

export function updateTaskMergeableState(
  db: Database.Database,
  prNumber: number,
  mergeableState: string | null
): void {
  if (!mergeableState) return
  try {
    db.prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?').run(
      mergeableState,
      prNumber
    )
  } catch (err) {
    console.warn(
      `[sprint-queries] failed to update mergeable_state for PR #${prNumber}:`,
      err
    )
  }
}

export function clearSprintTaskFk(db: Database.Database, agentRunId: string): void {
  try {
    db.prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?').run(
      agentRunId
    )
  } catch (err) {
    console.warn(
      `[sprint-queries] failed to clear FK for agent_run_id=${agentRunId}:`,
      err
    )
  }
}
