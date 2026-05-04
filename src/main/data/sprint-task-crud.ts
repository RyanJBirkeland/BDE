import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import { withRetryAsync } from './sqlite-retry'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS, SPRINT_TASK_LIST_COLUMNS } from './sprint-query-constants'
import { validateTransition, isTaskStatus } from '../../shared/task-state-machine'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { mapRowToTask, mapRowsToTasks, serializeFieldForStorage } from './sprint-task-mapper'
import { UPDATE_ALLOWLIST_SET, COLUMN_MAP } from './sprint-task-types'
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

function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
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
  // ESCAPE '\' prevents raw % and _ in user input from acting as wildcards.
  const pattern = `%${escapeLikePattern(search.toLowerCase())}%`
  clauses.push("(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(spec) LIKE ? ESCAPE '\\')")
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
      //
      // Both branches project SPRINT_TASK_LIST_COLUMNS — the heavy
      // `review_diff_snapshot` blob is excluded so the renderer's 30s poll
      // doesn't transfer hundreds of KB per task on every cycle.
      const rows = conn
        .prepare(
          `SELECT ${SPRINT_TASK_LIST_COLUMNS} FROM sprint_tasks
             WHERE status IN ('backlog','queued','blocked','active','review')
           UNION ALL
           SELECT ${SPRINT_TASK_LIST_COLUMNS} FROM sprint_tasks
             WHERE status IN ('done','cancelled','failed','error')
               AND completed_at >= datetime('now', '-7 days')
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

export async function createTask(
  input: CreateTaskInput,
  db?: Database.Database
): Promise<SprintTask | null> {
  const conn = db ?? getDb()
  try {
    return await withRetryAsync(() => {
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
    })
  } catch (err) {
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] createTask failed: ${msg}`)
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
export async function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): Promise<SprintTask | null> {
  // Reuse createTask instead of duplicating INSERT logic
  const task = await createTask({
    title: input.title,
    repo: input.repo,
    spec: input.spec,
    prompt: input.spec, // prompt mirrors spec — keeps the agent's full task message accessible
    status: 'review'
  })

  if (!task) return null

  // Set fields not in the create allowlist (worktree_path, started_at,
  // promoted_to_review_at). The adhoc path bypasses `transitionToReview`, so
  // the review-entry watermark has to be stamped here.
  const updated = await updateTask(task.id, {
    worktree_path: input.worktreePath,
    started_at: nowIso(),
    promoted_to_review_at: nowIso()
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

/**
 * NOTE: `updateTask` is NOT the primary enforcement point for status transitions.
 * All `sprint_tasks.status` writes must go through `TaskStateService.transition()`
 * (src/main/services/task-state-service.ts), which validates via `isValidTransition`,
 * persists via this function, and dispatches to the `TerminalDispatcher` port.
 *
 * The `enforceTransitionCheck` flag in `writeTaskUpdate` provides defense-in-depth
 * only — it fires when code bypasses `TaskStateService`. New callers must not call
 * `updateTask({ status })` directly; use `TaskStateService.transition()` instead.
 */

export async function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: UpdateTaskOptions,
  db?: Database.Database
): Promise<SprintTask | null> {
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
export async function forceUpdateTask(
  id: string,
  patch: Record<string, unknown>,
  db?: Database.Database
): Promise<SprintTask | null> {
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

/**
 * Narrow an allowlisted string key to `keyof SprintTask`. Every entry in
 * `UPDATE_ALLOWLIST` is, by construction, a valid `SprintTask` field — the
 * module-load invariant in `sprint-task-types.ts` guarantees it.
 */
type SprintTaskFieldKey = keyof SprintTask

function asSprintTaskField(key: string): SprintTaskFieldKey {
  return key as SprintTaskFieldKey
}

function readTaskField(task: SprintTask, key: SprintTaskFieldKey): SprintTask[SprintTaskFieldKey] {
  return task[key]
}

/** Convert a typed task into an indexable record for the audit writer. */
function toAuditableTask(task: SprintTask): Record<string, unknown> {
  const auditable: Record<string, unknown> = { ...task }
  return auditable
}

async function writeTaskUpdate(
  id: string,
  patch: Record<string, unknown>,
  options: WriteTaskUpdateOptions,
  db?: Database.Database
): Promise<SprintTask | null> {
  const allowlistedEntries = filterAllowlistedEntries(patch)
  if (allowlistedEntries.length === 0) return null

  try {
    const conn = db ?? getDb()
    return await withRetryAsync(() =>
      conn.transaction(() => runUpdate(id, patch, allowlistedEntries, options, conn))()
    )
  } catch (err) {
    return handleUpdateError(id, err)
  }
}

function runUpdate(
  id: string,
  patch: Record<string, unknown>,
  entries: Array<[SprintTaskFieldKey, unknown]>,
  options: WriteTaskUpdateOptions,
  conn: Database.Database
): SprintTask | null {
  const oldTask = getTask(id, conn)
  if (!oldTask) return null

  if (options.enforceTransitionCheck) {
    // TODO(arch): State-machine validation belongs in TaskStateService, not the data layer.
    // Tracked: move enforceTransitionOrThrow to task-state-service.ts and inject as a policy.
    enforceTransitionOrThrow(id, oldTask.status, patch.status)
  }

  const changedEntries = computeChangedEntries(entries, oldTask)
  if (changedEntries.length === 0) return oldTask

  const { setClauses, values, auditPatch } = buildUpdateSql(changedEntries)
  values.push(id)

  const updated = conn
    .prepare(
      `UPDATE sprint_tasks SET ${setClauses.join(', ')} WHERE id = ?
       RETURNING ${SPRINT_TASK_COLUMNS}`
    )
    .get(...values) as Record<string, unknown> | undefined
  if (!updated) return null

  recordAuditTrailOrAbort(id, oldTask, auditPatch, options.changedBy, conn)
  return mapRowToTask(updated)
}

function filterAllowlistedEntries(
  patch: Record<string, unknown>
): Array<[SprintTaskFieldKey, unknown]> {
  return Object.entries(patch)
    .filter(([k]) => UPDATE_ALLOWLIST_SET.has(k))
    .map(([k, v]) => [asSprintTaskField(k), v])
}

/**
 * Defense-in-depth assertion: throws when an invalid status transition reaches
 * the data layer. Primary enforcement lives in `TaskStateService.transition()`.
 * This guard fires only when code bypasses `TaskStateService` and calls
 * `updateTask` with a `status` field directly — protecting DB integrity if
 * a call site is missed during the EP-1 migration.
 *
 * Manual-override callers (`forceUpdateTask`) skip this via
 * `options.enforceTransitionCheck === false`.
 */
function enforceTransitionOrThrow(
  taskId: string,
  currentStatus: string,
  nextStatus: unknown
): void {
  if (typeof nextStatus !== 'string' || !isTaskStatus(nextStatus)) return
  if (!isTaskStatus(currentStatus)) return
  const validation = validateTransition(currentStatus, nextStatus)
  if (!validation.ok) {
    throw new Error(
      `[sprint-task-crud] Bypass-prevention: status write for task ${taskId} rejected at data layer — ${validation.reason}. Route through TaskStateService.transition() instead.`
    )
  }
}

/**
 * Strip entries whose serialized value equals the existing column value.
 * Avoids redundant SQL UPDATEs and audit-trail rows when the patch is a no-op.
 */
function computeChangedEntries(
  entries: Array<[SprintTaskFieldKey, unknown]>,
  oldTask: SprintTask
): Array<[SprintTaskFieldKey, unknown]> {
  return entries.filter(([key, value]) => {
    const serializedNew = serializeFieldForStorage(key, value)
    const serializedOld = serializeFieldForStorage(key, readTaskField(oldTask, key))
    return serializedNew !== serializedOld
  })
}

interface UpdateSql {
  setClauses: string[]
  values: unknown[]
  auditPatch: Record<string, unknown>
}

/**
 * Build the SET clause + bound values for the UPDATE statement and assemble
 * the parallel audit-patch (with sanitized JSON for `depends_on` / `tags`).
 * Splits responsibilities: this function knows column names and serialization,
 * the caller wires the result into a prepared statement.
 */
function buildUpdateSql(changedEntries: Array<[SprintTaskFieldKey, unknown]>): UpdateSql {
  const setClauses: string[] = []
  const values: unknown[] = []
  const auditPatch: Record<string, unknown> = {}

  for (const [fieldName, newValue] of changedEntries) {
    const colName = COLUMN_MAP.get(fieldName)
    if (!colName) throw new Error(`Invalid column name: ${fieldName}`)
    setClauses.push(`${colName} = ?`)
    values.push(serializeFieldForStorage(fieldName, newValue))
    auditPatch[fieldName] = buildAuditValue(fieldName, newValue)
  }
  return { setClauses, values, auditPatch }
}

function buildAuditValue(fieldName: SprintTaskFieldKey, newValue: unknown): unknown {
  if (fieldName === 'depends_on') return sanitizeDependsOn(newValue)
  if (fieldName === 'tags') return sanitizeTags(newValue)
  return newValue
}

function recordAuditTrailOrAbort(
  taskId: string,
  oldTask: SprintTask,
  auditPatch: Record<string, unknown>,
  changedBy: string,
  conn: Database.Database
): void {
  try {
    recordTaskChanges(taskId, toAuditableTask(oldTask), auditPatch, changedBy, conn)
  } catch (err) {
    getSprintQueriesLogger().warn(`[sprint-queries] Failed to record task changes: ${err}`)
    throw err
  }
}

function handleUpdateError(taskId: string, err: unknown): null {
  if (err instanceof Error && err.message.includes('Invalid transition')) {
    throw err
  }
  const msg = getErrorMessage(err)
  getSprintQueriesLogger().warn(`[sprint-queries] updateTask failed for id=${taskId}: ${msg}`)
  return null
}

/**
 * Persists the exact prompt text rendered for the agent's most recent run.
 * Uses a direct UPDATE instead of `updateTask` to bypass the audit trail —
 * last_rendered_prompt is operational metadata, not a user-visible field.
 */
export async function persistRenderedPrompt(
  taskId: string,
  prompt: string,
  db?: Database.Database
): Promise<void> {
  const conn = db ?? getDb()
  return withRetryAsync(() => {
    const sql = `UPDATE sprint_tasks SET last_rendered_prompt = ? WHERE id = ?`
    conn.prepare(sql).run(prompt, taskId)
  })
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
