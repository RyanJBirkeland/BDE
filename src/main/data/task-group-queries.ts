/**
 * Task group query functions — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type Database from 'better-sqlite3'
import type { TaskGroup, SprintTask, EpicDependency } from '../../shared/types'
import { getDb } from '../db'
import { mapRowsToTasks } from './sprint-queries'
import { getErrorMessage } from '../../shared/errors'
import type { Logger } from '../logger'
import { createLogger } from '../logger'

let _logger: Logger = createLogger('task-group-queries')

/**
 * Inject a logger. Called at app startup to route logs to the shared log file.
 * Mirrors the pattern from sprint-queries.ts setSprintQueriesLogger().
 */
export function setTaskGroupQueriesLogger(logger: Logger): void {
  _logger = logger
}

export interface CreateGroupInput {
  name: string
  icon?: string
  accent_color?: string
  goal?: string
  depends_on?: EpicDependency[] | null
}

export interface UpdateGroupInput {
  name?: string
  icon?: string
  accent_color?: string
  goal?: string
  status?: 'draft' | 'ready' | 'in-pipeline' | 'completed'
  depends_on?: EpicDependency[] | null
}

/**
 * Sanitize a single group row from SQLite.
 */
function sanitizeGroup(row: Record<string, unknown>): TaskGroup {
  let depends_on: EpicDependency[] | null = null
  if (row.depends_on && typeof row.depends_on === 'string') {
    try {
      const parsed = JSON.parse(row.depends_on)
      if (Array.isArray(parsed) && parsed.length > 0) {
        depends_on = parsed
      }
    } catch {
      // Malformed JSON → null
    }
  }

  return {
    id: String(row.id),
    name: String(row.name),
    icon: String(row.icon ?? 'G'),
    accent_color: String(row.accent_color ?? '#00ffcc'),
    goal: row.goal ? String(row.goal) : null,
    status: String(row.status ?? 'draft') as TaskGroup['status'],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    depends_on
  }
}

/**
 * Create a new task group.
 */
export function createGroup(input: CreateGroupInput, db?: Database.Database): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const dependsOnJson =
      input.depends_on && input.depends_on.length > 0 ? JSON.stringify(input.depends_on) : null

    const stmt = conn.prepare(`
      INSERT INTO task_groups (name, icon, accent_color, goal, depends_on)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `)
    const row = stmt.get(
      input.name,
      input.icon ?? 'G',
      input.accent_color ?? '#00ffcc',
      input.goal ?? null,
      dependsOnJson
    ) as Record<string, unknown> | undefined

    return row ? sanitizeGroup(row) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] createGroup failed: ${msg}`)
    return null
  }
}

/**
 * List all task groups.
 */
export function listGroups(db?: Database.Database): TaskGroup[] {
  try {
    const conn = db ?? getDb()
    const rows = conn.prepare('SELECT * FROM task_groups ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[]
    return rows.map(sanitizeGroup)
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] listGroups failed: ${msg}`)
    return []
  }
}

/**
 * Get a single group by ID.
 */
export function getGroup(id: string, db?: Database.Database): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const row = conn.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? sanitizeGroup(row) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] getGroup failed for id=${id}: ${msg}`)
    return null
  }
}

/**
 * Update a task group.
 */
export function updateGroup(
  id: string,
  patch: UpdateGroupInput,
  db?: Database.Database
): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const allowed = new Set(['name', 'icon', 'accent_color', 'goal', 'status', 'depends_on'])
    const fields = Object.keys(patch).filter((k) => allowed.has(k))
    if (fields.length === 0) return getGroup(id, db)

    const setClauses = fields.map((f) => `${f} = ?`)
    const values = fields.map((f) => {
      const value = patch[f as keyof UpdateGroupInput]
      // Serialize depends_on to JSON if present
      if (f === 'depends_on') {
        return value && Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null
      }
      return value
    })

    const stmt = conn.prepare(`
      UPDATE task_groups
      SET ${setClauses.join(', ')}
      WHERE id = ?
      RETURNING *
    `)
    const row = stmt.get(...values, id) as Record<string, unknown> | undefined

    return row ? sanitizeGroup(row) : null
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] updateGroup failed for id=${id}: ${msg}`)
    return null
  }
}

/**
 * Delete a task group. Sets group_id to NULL for all associated tasks.
 */
export function deleteGroup(id: string, db?: Database.Database): void {
  const conn = db ?? getDb()
  try {
    conn.transaction(() => {
      conn.prepare('UPDATE sprint_tasks SET group_id = NULL WHERE group_id = ?').run(id)
      conn.prepare('DELETE FROM task_groups WHERE id = ?').run(id)
    })()
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] deleteGroup failed for id=${id}: ${msg}`)
    throw err
  }
}

/**
 * Add a task to a group.
 */
export function addTaskToGroup(taskId: string, groupId: string, db?: Database.Database): boolean {
  try {
    const conn = db ?? getDb()
    const result = conn
      .prepare('UPDATE sprint_tasks SET group_id = ? WHERE id = ?')
      .run(groupId, taskId)
    return result.changes > 0
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] addTaskToGroup failed: ${msg}`)
    return false
  }
}

/**
 * Remove a task from its group.
 */
export function removeTaskFromGroup(taskId: string, db?: Database.Database): boolean {
  try {
    const conn = db ?? getDb()
    const result = conn.prepare('UPDATE sprint_tasks SET group_id = NULL WHERE id = ?').run(taskId)
    return result.changes > 0
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] removeTaskFromGroup failed: ${msg}`)
    return false
  }
}

/**
 * Get all tasks in a group.
 */
export function getGroupTasks(groupId: string, db?: Database.Database): SprintTask[] {
  try {
    const conn = db ?? getDb()
    const rows = conn
      .prepare(
        'SELECT * FROM sprint_tasks WHERE group_id = ? ORDER BY sort_order ASC, priority DESC, created_at'
      )
      .all(groupId) as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] getGroupTasks failed for group=${groupId}: ${msg}`)
    return []
  }
}

/**
 * Queue all backlog tasks in a group.
 */
export function queueAllGroupTasks(groupId: string, db?: Database.Database): number {
  try {
    const conn = db ?? getDb()
    const result = conn
      .prepare(
        `UPDATE sprint_tasks SET status = 'queued' WHERE group_id = ? AND status = 'backlog'`
      )
      .run(groupId)
    return result.changes
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] queueAllGroupTasks failed for group=${groupId}: ${msg}`)
    return 0
  }
}

/**
 * Reorder tasks within a group by setting sort_order values.
 * Takes an array of task IDs in the desired order.
 */
export function reorderGroupTasks(
  groupId: string,
  orderedTaskIds: string[],
  db?: Database.Database
): boolean {
  try {
    const conn = db ?? getDb()
    const updateStmt = conn.prepare('UPDATE sprint_tasks SET sort_order = ? WHERE id = ?')

    const transaction = conn.transaction(() => {
      orderedTaskIds.forEach((taskId, index) => {
        updateStmt.run(index, taskId)
      })
    })

    transaction()
    return true
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] reorderGroupTasks failed for group=${groupId}: ${msg}`)
    return false
  }
}

/**
 * Persist a new epic dependency edge to the database.
 *
 * IMPORTANT: Cycle detection MUST be performed BEFORE calling this function.
 * Use `detectEpicCycle()` from `src/main/services/epic-dependency-service.ts`.
 * All callers must go through the `groups:addDependency` IPC handler in
 * `src/main/handlers/group-handlers.ts`, which enforces this invariant.
 * Direct calls to this function that bypass cycle detection can corrupt the
 * epic dependency graph.
 */
export function addGroupDependency(
  groupId: string,
  dep: EpicDependency,
  db?: Database.Database
): TaskGroup | null {
  const conn = db ?? getDb()
  try {
    return conn.transaction((): TaskGroup | null => {
      const group = getGroup(groupId, conn)
      if (!group) throw new Error(`Group not found: ${groupId}`)

      const currentDeps = group.depends_on ?? []
      // Prevent duplicates
      if (currentDeps.some((d) => d.id === dep.id)) {
        throw new Error(`Dependency already exists: ${dep.id}`)
      }

      const newDeps = [...currentDeps, dep]
      return updateGroup(groupId, { depends_on: newDeps }, conn)
    })()
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] addGroupDependency failed: ${msg}`)
    throw err
  }
}

/**
 * Remove an epic dependency from a group.
 */
export function removeGroupDependency(
  groupId: string,
  upstreamId: string,
  db?: Database.Database
): TaskGroup | null {
  const conn = db ?? getDb()
  try {
    return conn.transaction((): TaskGroup | null => {
      const group = getGroup(groupId, conn)
      if (!group) throw new Error(`Group not found: ${groupId}`)

      const currentDeps = group.depends_on ?? []
      const newDeps = currentDeps.filter((d) => d.id !== upstreamId)

      return updateGroup(groupId, { depends_on: newDeps.length > 0 ? newDeps : null }, conn)
    })()
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] removeGroupDependency failed: ${msg}`)
    throw err
  }
}

/**
 * Update the condition of an existing epic dependency.
 */
export function updateGroupDependencyCondition(
  groupId: string,
  upstreamId: string,
  condition: EpicDependency['condition'],
  db?: Database.Database
): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const group = getGroup(groupId, conn)
    if (!group) throw new Error(`Group not found: ${groupId}`)

    const currentDeps = group.depends_on ?? []
    const depIndex = currentDeps.findIndex((d) => d.id === upstreamId)
    if (depIndex === -1) {
      throw new Error(`Dependency not found: ${upstreamId}`)
    }

    const newDeps = [...currentDeps]
    newDeps[depIndex] = { ...newDeps[depIndex], condition }

    return updateGroup(groupId, { depends_on: newDeps }, conn)
  } catch (err) {
    const msg = getErrorMessage(err)
    _logger.error(`[task-group-queries] updateGroupDependencyCondition failed: ${msg}`)
    throw err
  }
}

/**
 * Get all task groups with their dependencies for index rebuilding.
 * Returns id + depends_on for all groups (not just those with dependencies).
 */
export function getGroupsWithDependencies(
  db?: Database.Database
): Array<{ id: string; depends_on: EpicDependency[] | null }> {
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT id, depends_on FROM task_groups').all() as Array<{
    id: string
    depends_on: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    depends_on: row.depends_on ? (JSON.parse(row.depends_on) as EpicDependency[]) : null
  }))
}
