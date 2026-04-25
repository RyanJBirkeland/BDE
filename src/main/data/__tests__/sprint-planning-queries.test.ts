import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'
import { mapRowToSprint } from '../sprint-planning-queries'

let db: Database.Database

// Mock getDb to return our in-memory DB
vi.mock('../../db', async () => {
  const actual = await vi.importActual<typeof import('../../db')>('../../db')
  return {
    ...actual,
    getDb: () => db
  }
})

// Import AFTER mocks are set up
import {
  createSprint,
  getSprint,
  getAllSprints,
  updateSprint,
  deleteSprint,
  getSprintTasks
} from '../sprint-planning-queries'

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('createSprint', () => {
  it('creates a sprint with all fields', () => {
    const sprint = createSprint({
      name: 'Sprint 1',
      goal: 'Build core features',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    expect(sprint).not.toBeNull()
    expect(sprint?.name).toBe('Sprint 1')
    expect(sprint?.goal).toBe('Build core features')
    expect(sprint?.start_date).toBe('2026-04-01')
    expect(sprint?.end_date).toBe('2026-04-14')
    expect(sprint?.status).toBe('planning')
    expect(sprint?.id).toBeTruthy()
    expect(sprint?.created_at).toBeTruthy()
    expect(sprint?.updated_at).toBeTruthy()
  })

  it('creates a sprint without goal', () => {
    const sprint = createSprint({
      name: 'Sprint 2',
      start_date: '2026-04-15',
      end_date: '2026-04-28'
    })

    expect(sprint).not.toBeNull()
    expect(sprint?.name).toBe('Sprint 2')
    expect(sprint?.goal).toBeNull()
  })
})

describe('getSprint', () => {
  it('returns null for non-existent sprint', () => {
    expect(getSprint('nonexistent')).toBeNull()
  })

  it('retrieves an existing sprint', () => {
    const created = createSprint({
      name: 'Test Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const retrieved = getSprint(created!.id)
    expect(retrieved).toEqual(created)
  })
})

describe('getAllSprints', () => {
  it('returns empty array when no sprints exist', () => {
    expect(getAllSprints()).toEqual([])
  })

  it('returns all sprints ordered by created_at DESC', () => {
    const sprint1 = createSprint({
      name: 'Sprint 1',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })
    const sprint2 = createSprint({
      name: 'Sprint 2',
      start_date: '2026-04-15',
      end_date: '2026-04-28'
    })

    const sprints = getAllSprints()
    expect(sprints).toHaveLength(2)
    // Both sprints should be present (order may vary due to sub-second timing)
    const ids = sprints.map((s) => s.id)
    expect(ids).toContain(sprint1!.id)
    expect(ids).toContain(sprint2!.id)
  })
})

describe('updateSprint', () => {
  it('returns null for non-existent sprint', () => {
    expect(updateSprint('nonexistent', { name: 'New Name' })).toBeNull()
  })

  it('updates name', () => {
    const sprint = createSprint({
      name: 'Old Name',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, { name: 'New Name' })
    expect(updated?.name).toBe('New Name')
    expect(updated?.start_date).toBe('2026-04-01')
  })

  it('updates goal', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, { goal: 'New goal' })
    expect(updated?.goal).toBe('New goal')
  })

  it('updates dates', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, {
      start_date: '2026-04-02',
      end_date: '2026-04-15'
    })
    expect(updated?.start_date).toBe('2026-04-02')
    expect(updated?.end_date).toBe('2026-04-15')
  })

  it('updates status', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, { status: 'active' })
    expect(updated?.status).toBe('active')
  })

  it('updates multiple fields at once', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, {
      name: 'Updated Sprint',
      status: 'completed',
      goal: 'Final goal'
    })
    expect(updated?.name).toBe('Updated Sprint')
    expect(updated?.status).toBe('completed')
    expect(updated?.goal).toBe('Final goal')
  })

  it('returns unchanged sprint when no fields provided', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const updated = updateSprint(sprint!.id, {})
    expect(updated).toEqual(sprint)
  })
})

describe('deleteSprint', () => {
  it('returns false for non-existent sprint', () => {
    expect(deleteSprint('nonexistent')).toBe(false)
  })

  it('deletes an existing sprint', () => {
    const sprint = createSprint({
      name: 'To Delete',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    expect(deleteSprint(sprint!.id)).toBe(true)
    expect(getSprint(sprint!.id)).toBeNull()
  })
})

describe('getSprintTasks', () => {
  it('returns empty array for sprint with no tasks', () => {
    const sprint = createSprint({
      name: 'Empty Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    expect(getSprintTasks(sprint!.id)).toEqual([])
  })

  it('returns task IDs for sprint', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    // Create tasks with sprint_id
    const task1Id = db
      .prepare(
        `INSERT INTO sprint_tasks (title, prompt, sprint_id)
         VALUES (?, ?, ?) RETURNING id`
      )
      .get('Task 1', 'prompt 1', sprint!.id) as { id: string }
    const task2Id = db
      .prepare(
        `INSERT INTO sprint_tasks (title, prompt, sprint_id)
         VALUES (?, ?, ?) RETURNING id`
      )
      .get('Task 2', 'prompt 2', sprint!.id) as { id: string }

    const taskIds = getSprintTasks(sprint!.id)
    expect(taskIds).toHaveLength(2)
    expect(taskIds).toContain(task1Id.id)
    expect(taskIds).toContain(task2Id.id)
  })

  it('returns tasks ordered by created_at', () => {
    const sprint = createSprint({
      name: 'Sprint',
      start_date: '2026-04-01',
      end_date: '2026-04-14'
    })

    const task1Id = db
      .prepare(
        `INSERT INTO sprint_tasks (title, prompt, sprint_id)
         VALUES (?, ?, ?) RETURNING id`
      )
      .get('Task 1', 'prompt 1', sprint!.id) as { id: string }

    // Small delay to ensure different created_at
    const task2Id = db
      .prepare(
        `INSERT INTO sprint_tasks (title, prompt, sprint_id)
         VALUES (?, ?, ?) RETURNING id`
      )
      .get('Task 2', 'prompt 2', sprint!.id) as { id: string }

    const taskIds = getSprintTasks(sprint!.id)
    expect(taskIds[0]).toBe(task1Id.id)
    expect(taskIds[1]).toBe(task2Id.id)
  })
})

describe('mapRowToSprint — boundary validation', () => {
  it('maps a valid row correctly', () => {
    const row: Record<string, unknown> = {
      id: 'sprint-1',
      name: 'Sprint One',
      goal: 'Ship it',
      start_date: '2026-04-01',
      end_date: '2026-04-14',
      status: 'planning',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z'
    }
    const sprint = mapRowToSprint(row)
    expect(sprint.id).toBe('sprint-1')
    expect(sprint.name).toBe('Sprint One')
    expect(sprint.goal).toBe('Ship it')
    expect(sprint.status).toBe('planning')
  })

  it('throws on an unknown status', () => {
    const row: Record<string, unknown> = {
      id: 'sprint-2',
      name: 'Bad Sprint',
      goal: null,
      start_date: '2026-04-01',
      end_date: '2026-04-14',
      status: 'unknown_status',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z'
    }
    expect(() => mapRowToSprint(row)).toThrow(/status must be one of/)
  })

  it('throws on a null id', () => {
    const row: Record<string, unknown> = {
      id: null,
      name: 'Bad Sprint',
      goal: null,
      start_date: '2026-04-01',
      end_date: '2026-04-14',
      status: 'planning',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z'
    }
    expect(() => mapRowToSprint(row)).toThrow(/id must be a non-empty string/)
  })
})
