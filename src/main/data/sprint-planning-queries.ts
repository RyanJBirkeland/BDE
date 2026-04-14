import type Database from 'better-sqlite3'
import { getDb } from '../db'
import type { Sprint } from '../../shared/types'

export function createSprint(
  input: {
    name: string
    goal?: string
    start_date: string
    end_date: string
  },
  db?: Database.Database
): Sprint | null {
  const conn = db ?? getDb()
  const row = conn
    .prepare(
      `INSERT INTO sprints (name, goal, start_date, end_date)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(input.name, input.goal ?? null, input.start_date, input.end_date) as Record<
    string,
    unknown
  > | null

  if (!row) return null

  return {
    id: row.id as string,
    name: row.name as string,
    goal: (row.goal as string) ?? null,
    start_date: row.start_date as string,
    end_date: row.end_date as string,
    status: row.status as Sprint['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }
}

export function getSprint(id: string, db?: Database.Database): Sprint | null {
  const conn = db ?? getDb()
  const row = conn.prepare('SELECT * FROM sprints WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined

  if (!row) return null

  return {
    id: row.id as string,
    name: row.name as string,
    goal: (row.goal as string) ?? null,
    start_date: row.start_date as string,
    end_date: row.end_date as string,
    status: row.status as Sprint['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }
}

export function getAllSprints(db?: Database.Database): Sprint[] {
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT * FROM sprints ORDER BY created_at DESC').all() as Record<
    string,
    unknown
  >[]

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    goal: (row.goal as string) ?? null,
    start_date: row.start_date as string,
    end_date: row.end_date as string,
    status: row.status as Sprint['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }))
}

export function updateSprint(
  id: string,
  patch: Partial<Pick<Sprint, 'name' | 'goal' | 'start_date' | 'end_date' | 'status'>>,
  db?: Database.Database
): Sprint | null {
  const conn = db ?? getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (patch.name !== undefined) {
    fields.push('name = ?')
    values.push(patch.name)
  }
  if (patch.goal !== undefined) {
    fields.push('goal = ?')
    values.push(patch.goal)
  }
  if (patch.start_date !== undefined) {
    fields.push('start_date = ?')
    values.push(patch.start_date)
  }
  if (patch.end_date !== undefined) {
    fields.push('end_date = ?')
    values.push(patch.end_date)
  }
  if (patch.status !== undefined) {
    fields.push('status = ?')
    values.push(patch.status)
  }

  if (fields.length === 0) return getSprint(id, db)

  values.push(id)

  const row = conn
    .prepare(`UPDATE sprints SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
    .get(...values) as Record<string, unknown> | undefined

  if (!row) return null

  return {
    id: row.id as string,
    name: row.name as string,
    goal: (row.goal as string) ?? null,
    start_date: row.start_date as string,
    end_date: row.end_date as string,
    status: row.status as Sprint['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }
}

export function deleteSprint(id: string, db?: Database.Database): boolean {
  const conn = db ?? getDb()
  const result = conn.prepare('DELETE FROM sprints WHERE id = ?').run(id)
  return result.changes > 0
}

export function getSprintTasks(sprintId: string, db?: Database.Database): string[] {
  const conn = db ?? getDb()
  const rows = conn
    .prepare('SELECT id FROM sprint_tasks WHERE sprint_id = ? ORDER BY created_at')
    .all(sprintId) as { id: string }[]
  return rows.map((row) => row.id)
}
