/**
 * PR group query functions — SQLite edition.
 * All functions accept an optional `db` parameter for dependency injection (testing).
 */
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { PrGroup } from '../../shared/types/task-types'
import { getDb } from '../db'
import { createLogger } from '../logger'
import type { Logger } from '../logger'
import { withDataLayerError } from './data-utils'

let _logger: Logger = createLogger('pr-group-queries')

export function setPrGroupQueriesLogger(logger: Logger): void {
  _logger = logger
}

// --- Row mapping ---

const VALID_PR_GROUP_STATUSES: ReadonlySet<string> = new Set([
  'composing',
  'building',
  'open',
  'merged'
])

function isPrGroupStatus(value: unknown): value is PrGroup['status'] {
  return typeof value === 'string' && VALID_PR_GROUP_STATUSES.has(value)
}

function sanitizeTaskOrder(raw: unknown): string[] {
  const parsed = Array.isArray(raw) ? raw : []
  return parsed.filter((id): id is string => typeof id === 'string')
}

function rowToGroup(row: Record<string, unknown>): PrGroup {
  let task_order: string[] = []
  try {
    const rawOrder = JSON.parse((row.task_order as string) || '[]')
    task_order = sanitizeTaskOrder(rawOrder)
  } catch {
    _logger.warn(
      `[pr-group-queries] Malformed task_order JSON for id="${String(row.id)}"; defaulting to []`
    )
  }

  let status: PrGroup['status'] = 'composing'
  if (isPrGroupStatus(row.status)) {
    status = row.status
  } else if (row.status != null) {
    _logger.warn(
      `[pr-group-queries] Unknown PrGroup status "${String(row.status)}" for id="${String(row.id)}"; defaulting to "composing"`
    )
  }

  return {
    id: String(row.id),
    repo: String(row.repo),
    title: String(row.title),
    branch_name: String(row.branch_name),
    description: row.description != null ? String(row.description) : null,
    status,
    task_order,
    pr_number: row.pr_number != null ? Number(row.pr_number) : null,
    pr_url: row.pr_url != null ? String(row.pr_url) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  }
}

function now(): string {
  return new Date().toISOString()
}

// --- Queries ---

export function listPrGroups(repo?: string, db?: Database.Database): PrGroup[] {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const rows = repo
        ? (conn
            .prepare('SELECT * FROM pr_groups WHERE repo = ? ORDER BY created_at DESC')
            .all(repo) as Record<string, unknown>[])
        : (conn
            .prepare('SELECT * FROM pr_groups ORDER BY created_at DESC')
            .all() as Record<string, unknown>[])
      return rows.map(rowToGroup)
    },
    'listPrGroups',
    [],
    _logger
  )
}

export function getPrGroup(id: string, db?: Database.Database): PrGroup | null {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const row = conn.prepare('SELECT * FROM pr_groups WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      return row ? rowToGroup(row) : null
    },
    `getPrGroup(id=${id})`,
    null,
    _logger
  )
}

export interface CreatePrGroupInput {
  repo: string
  title: string
  branchName: string
  description?: string | undefined
}

export function createPrGroup(input: CreatePrGroupInput, db?: Database.Database): PrGroup | null {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const id = randomUUID().replace(/-/g, '')
      const ts = now()
      const sql = `
        INSERT INTO pr_groups (id, repo, title, branch_name, description, status, task_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'composing', '[]', ?, ?)
        RETURNING *
      `
      const row = conn
        .prepare(sql)
        .get(id, input.repo, input.title, input.branchName, input.description ?? null, ts, ts) as
        | Record<string, unknown>
        | undefined
      return row ? rowToGroup(row) : null
    },
    'createPrGroup',
    null,
    _logger
  )
}

export interface UpdatePrGroupInput {
  title?: string | undefined
  branchName?: string | undefined
  description?: string | null | undefined
  taskOrder?: string[] | undefined
  status?: PrGroup['status'] | undefined
  prNumber?: number | null | undefined
  prUrl?: string | null | undefined
}

export function updatePrGroup(
  id: string,
  input: UpdatePrGroupInput,
  db?: Database.Database
): PrGroup | null {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const fields: string[] = []
      const values: unknown[] = []

      if (input.title !== undefined) {
        fields.push('title = ?')
        values.push(input.title)
      }
      if (input.branchName !== undefined) {
        fields.push('branch_name = ?')
        values.push(input.branchName)
      }
      if (input.description !== undefined) {
        fields.push('description = ?')
        values.push(input.description)
      }
      if (input.taskOrder !== undefined) {
        fields.push('task_order = ?')
        values.push(JSON.stringify(input.taskOrder))
      }
      if (input.status !== undefined) {
        fields.push('status = ?')
        values.push(input.status)
      }
      if (input.prNumber !== undefined) {
        fields.push('pr_number = ?')
        values.push(input.prNumber)
      }
      if (input.prUrl !== undefined) {
        fields.push('pr_url = ?')
        values.push(input.prUrl)
      }

      if (fields.length === 0) return getPrGroup(id, conn)

      fields.push('updated_at = ?')
      values.push(now())
      values.push(id)

      const sql = `UPDATE pr_groups SET ${fields.join(', ')} WHERE id = ? RETURNING *`
      const row = conn.prepare(sql).get(...values) as Record<string, unknown> | undefined
      return row ? rowToGroup(row) : null
    },
    `updatePrGroup(id=${id})`,
    null,
    _logger
  )
}

export function addTaskToGroup(
  groupId: string,
  taskId: string,
  db?: Database.Database
): PrGroup | null {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const group = getPrGroup(groupId, conn)
      if (!group) return null
      if (group.task_order.includes(taskId)) return group
      return updatePrGroup(groupId, { taskOrder: [...group.task_order, taskId] }, conn)
    },
    `addTaskToGroup(groupId=${groupId}, taskId=${taskId})`,
    null,
    _logger
  )
}

export function removeTaskFromGroup(
  groupId: string,
  taskId: string,
  db?: Database.Database
): PrGroup | null {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const group = getPrGroup(groupId, conn)
      if (!group) return null
      return updatePrGroup(
        groupId,
        { taskOrder: group.task_order.filter((id) => id !== taskId) },
        conn
      )
    },
    `removeTaskFromGroup(groupId=${groupId}, taskId=${taskId})`,
    null,
    _logger
  )
}

export function deletePrGroup(id: string, db?: Database.Database): boolean {
  return withDataLayerError(
    () => {
      const conn = db ?? getDb()
      const result = conn.prepare('DELETE FROM pr_groups WHERE id = ?').run(id)
      return result.changes > 0
    },
    `deletePrGroup(id=${id})`,
    false,
    _logger
  )
}
