import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import { withRetry } from './sqlite-retry'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { validateTransition } from '../../shared/task-state-machine'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { mapRowToTask, mapRowsToTasks, serializeFieldForStorage } from './sprint-task-mapper'
import { UPDATE_ALLOWLIST, COLUMN_MAP } from './sprint-task-types'
import type { CreateTaskInput } from './sprint-task-types'
import { withDataLayerError } from './data-utils'

export function getTask(id: string, db?: Database.Database): SprintTask | null {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const row = conn
        .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined
      return row ? mapRowToTask(row) : null
    },
    `getTask(id=${id})`,
    null,
    getSprintQueriesLogger()
  )
}

/**
 * Options for `listTasks`. All filters are pushed into SQL so callers
 * never pay the cost of loading every sprint task row only to filter
 * in memory. When omitted, the result falls back to the legacy
 * "everything, sorted by priority then created_at" behaviour.
 */
export interface ListTasksOptions {
  /** Exact-match on `status`. */
  status?: string | undefined
  /** Exact-match on `repo`. */
  repo?: string | undefined
  /** Exact-match on `group_id` (epic/group id). */
  epicId?: string | undefined
  /** Must appear in the JSON `tags` array; exact string match. */
  tag?: string | undefined
  /** Case-insensitive substring on `title` OR `spec`. */
  search?: string | undefined
  /** Maximum rows to return. No upper bound — MCP schema caps at 500. */
  limit?: number | undefined
  /** Rows to skip before the returned page. */
  offset?: number | undefined
}

/**
 * List sprint tasks, optionally filtered and paginated.
 *
 * Accepts either a bare status string (legacy signature preserved for
 * existing callers) or a `ListTasksOptions` object. The options path
 * pushes every filter into SQL; the legacy path stays a single
 * index-hitting `WHERE status = ?`.
 */
export function listTasks(
  statusOrOptions?: string | ListTasksOptions,
  db?: Database.Database
): SprintTask[] {
  const options = normalizeListTasksArg(statusOrOptions)
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const { sql, params } = buildListTasksQuery(options)
      const rows = conn.prepare(sql).all(...params) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    },
    'listTasks',
    [],
    getSprintQueriesLogger()
  )
}

function normalizeListTasksArg(
  statusOrOptions: string | ListTasksOptions | undefined
): ListTasksOptions {
  if (statusOrOptions === undefined) return {}
  if (typeof statusOrOptions === 'string') return { status: statusOrOptions }
  return statusOrOptions
}

function buildListTasksQuery(options: ListTasksOptions): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  appendEqualityClauses(clauses, params, options)
  appendTagClause(clauses, params, options.tag)
  appendSearchClause(clauses, params, options.search)

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const paginationSql = buildPaginationSql(params, options)

  const sql = `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks
    ${where}
    ORDER BY priority ASC, created_at ASC
    ${paginationSql}`
  return { sql, params }
}

function appendEqualityClauses(
  clauses: string[],
  params: unknown[],
  options: ListTasksOptions
): void {
  if (options.status) {
    clauses.push('status = ?')
    params.push(options.status)
  }
  if (options.repo) {
    clauses.push('repo = ?')
    params.push(options.repo)
  }
  if (options.epicId) {
    clauses.push('group_id = ?')
    params.push(options.epicId)
  }
}

function appendTagClause(clauses: string[], params: unknown[], tag: string | undefined): void {
  if (!tag) return
  // JSON1 `json_each` expands the tags array into a virtual table so we
  // compare by value instead of substring-matching the stored JSON text.
  clauses.push('EXISTS (SELECT 1 FROM json_each(sprint_tasks.tags) WHERE value = ?)')
  params.push(tag)
}

function appendSearchClause(
  clauses: string[],
  params: unknown[],
  search: string | undefined
): void {
  if (!search) return
  // SQLite `LIKE` is case-insensitive on ASCII by default; being explicit
  // with LOWER() matches filterInMemory's prior behavior across non-ASCII.
  // `LIKE` on NULL returns NULL (falsy) — NULL specs naturally drop out.
  const pattern = `%${search.toLowerCase()}%`
  clauses.push('(LOWER(title) LIKE ? OR LOWER(spec) LIKE ?)')
  params.push(pattern, pattern)
}

function buildPaginationSql(params: unknown[], options: ListTasksOptions): string {
  const hasPagination = options.limit !== undefined || options.offset !== undefined
  if (!hasPagination) return ''
  // Default limit matches the old in-memory slice (100); default offset is 0.
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  params.push(limit, offset)
  return 'LIMIT ? OFFSET ?'
}

export function listTasksRecent(db?: Database.Database): SprintTask[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      // UNION ALL of two index-able branches instead of OR-clause.
      // The original `WHERE status NOT IN (...) OR completed_at >= ...` forced
      // a full SCAN because OR across columns prevents single-index use. The
      // UNION ALL form lets each branch use idx_sprint_tasks_status:
      //   1) active set: status IN (5 active statuses)
      //   2) recent terminal set: status IN (4 terminal) AND completed_at recent
      const rows = conn
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
    },
    'listTasksRecent',
    [],
    getSprintQueriesLogger()
  )
}

export function createTask(input: CreateTaskInput, db?: Database.Database): SprintTask | null {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const dependsOn = sanitizeDependsOn(input.depends_on)
      const tags = sanitizeTags(input.tags)

      const result = conn
        .prepare(
          `INSERT INTO sprint_tasks (title, repo, prompt, spec, spec_type, notes, priority, status, template_name, depends_on, playground_enabled, max_runtime_ms, model, tags, group_id, cross_repo_contract)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`
        )
        .get(
          input.title,
          input.repo,
          input.prompt ?? input.spec ?? input.title,
          input.spec ?? null,
          input.spec_type ?? null,
          input.notes ?? null,
          input.priority ?? 0,
          input.status ?? 'backlog',
          input.template_name ?? null,
          dependsOn ? JSON.stringify(dependsOn) : null,
          input.playground_enabled ? 1 : 0,
          input.max_runtime_ms ?? null,
          input.model ?? null,
          tags ? JSON.stringify(tags) : null,
          input.group_id ?? null,
          input.cross_repo_contract ?? null
        ) as Record<string, unknown> | undefined

      return result ? mapRowToTask(result) : null
    },
    'createTask',
    null,
    getSprintQueriesLogger()
  )
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
    getSprintQueriesLogger().info(
      `[sprint-queries] Promoted adhoc work to review task ${updated.id} (branch ${input.branch})`
    )
  }

  return updated
}

/**
 * Options for `updateTask`.
 *
 * `caller` identifies *who* initiated the write, and is recorded in the
 * `task_changes` audit trail as the `changed_by` value. It lets operators
 * tell MCP-originated writes (`'mcp'` or `'mcp:<client-name>'`) apart from
 * IPC-originated ones (`'ipc'`, `'ui'`, etc.) without reverse-engineering
 * the change log. When omitted, the attribution falls back to `'unknown'`
 * for backward compatibility with historical call sites.
 */
export interface UpdateTaskOptions {
  caller?: string
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: UpdateTaskOptions,
  db?: Database.Database
): SprintTask | null {
  return writeTaskUpdate(
    id,
    patch,
    { enforceTransitionCheck: true, changedBy: options?.caller ?? 'unknown' },
    db
  )
}

/**
 * Operator escape-hatch for manual overrides (sprint:forceFailTask / sprint:forceDoneTask).
 * Writes a terminal status without running the state-machine transition check, so humans
 * can rescue tasks stuck in states that have no lawful path to the desired terminal
 * state (e.g. `blocked → failed`). Changes are still recorded in `task_changes` for
 * the audit trail, attributed to `'manual-override'`.
 */
export function forceUpdateTask(
  id: string,
  patch: Record<string, unknown>,
  db?: Database.Database
): SprintTask | null {
  return writeTaskUpdate(
    id,
    patch,
    { enforceTransitionCheck: false, changedBy: 'manual-override' },
    db
  )
}

interface WriteTaskUpdateOptions {
  enforceTransitionCheck: boolean
  changedBy: string
}

function writeTaskUpdate(
  id: string,
  patch: Record<string, unknown>,
  options: WriteTaskUpdateOptions,
  db?: Database.Database
): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  try {
    const conn = db ?? getDb()

    // Wrap read, update, and audit in a single transaction with retry on SQLITE_BUSY
    return withRetry(() =>
      conn.transaction(() => {
        // Fetch current state for change tracking
        const oldTask = getTask(id, conn)
        if (!oldTask) return null

        // Enforce status transition state machine (skipped for manual overrides)
        if (options.enforceTransitionCheck && patch.status && typeof patch.status === 'string') {
          const currentStatus = oldTask.status as string
          const validationResult = validateTransition(currentStatus, patch.status)
          if (!validationResult.ok) {
            throw new Error(
              `[sprint-queries] Invalid transition for task ${id}: ${validationResult.reason}`
            )
          }
        }

        // Filter unchanged fields at the caller level. Reduces
        // write amplification on both sprint_tasks (no UPDATE) and task_changes
        // (no audit row). Defense-in-depth — recordTaskChanges also skips
        // unchanged values, but filtering here also avoids the SQL UPDATE.
        const changedEntries = entries.filter(([key, value]) => {
          const serializedNew = serializeFieldForStorage(key, value)
          const oldRaw = (oldTask as unknown as Record<string, unknown>)[key]
          const serializedOld = serializeFieldForStorage(key, oldRaw)
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

        for (const [fieldName, newValue] of changedEntries) {
          // Whitelist Map replaces regex for defense-in-depth
          const colName = COLUMN_MAP.get(fieldName)
          if (!colName) {
            throw new Error(`Invalid column name: ${fieldName}`)
          }
          setClauses.push(`${colName} = ?`)
          const serialized = serializeFieldForStorage(fieldName, newValue)
          values.push(serialized)
          // For audit, store the sanitized form for depends_on/tags but original for others
          if (fieldName === 'depends_on') {
            auditPatch[fieldName] = sanitizeDependsOn(newValue)
          } else if (fieldName === 'tags') {
            auditPatch[fieldName] = sanitizeTags(newValue)
          } else {
            auditPatch[fieldName] = newValue
          }
        }

        values.push(id)

        const result = conn
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
            options.changedBy,
            conn
          )
        } catch (err) {
          getSprintQueriesLogger().warn(`[sprint-queries] Failed to record task changes: ${err}`)
          // Re-throw to abort transaction
          throw err
        }

        return mapRowToTask(result)
      })()
    )
  } catch (err) {
    // Re-throw invalid transition errors so callers can surface them to the UI
    if (err instanceof Error && err.message.includes('Invalid transition')) {
      throw err
    }
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] updateTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function deleteTask(
  id: string,
  deletedBy: string = 'unknown',
  db?: Database.Database
): void {
  const conn = db ?? getDb()
  withDataLayerError(
    () => {
      // DL-14 & DL-18: Record deletion in audit trail before removing task (pass db for consistency)
      conn.transaction(() => {
        const task = getTask(id, conn)
        if (task) {
          // Record deletion event with task snapshot
          conn
            .prepare(
              'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)'
            )
            .run(id, '_deleted', JSON.stringify(task), null, deletedBy)
        }
        // Delete task and orphaned audit records
        conn.prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
      })()
    },
    `deleteTask(id=${id})`,
    undefined,
    getSprintQueriesLogger()
  )
}
