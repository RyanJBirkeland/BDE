import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import {
  getTask,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  claimTask,
  releaseTask,
  getQueueStats,
  getDoneTodayCount,
  listTasksWithOpenPrs,
  clearSprintTaskFk,
  UPDATE_ALLOWLIST,
} from '../sprint-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('getTask', () => {
  it('returns null for non-existent task', () => {
    expect(getTask(db, 'nonexistent')).toBeFalsy()
  })

  it('returns the task when it exists', () => {
    const created = createTask(db, { title: 'Test task', repo: 'bde' })
    const found = getTask(db, created.id)
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Test task')
    expect(found!.repo).toBe('bde')
  })
})

describe('listTasks', () => {
  it('returns all tasks when no status filter', () => {
    createTask(db, { title: 'Task 1', repo: 'bde', status: 'backlog' })
    createTask(db, { title: 'Task 2', repo: 'bde', status: 'queued' })
    const all = listTasks(db)
    expect(all).toHaveLength(2)
  })

  it('returns only tasks matching status filter', () => {
    createTask(db, { title: 'Task 1', repo: 'bde', status: 'backlog' })
    createTask(db, { title: 'Task 2', repo: 'bde', status: 'queued' })
    const queued = listTasks(db, 'queued')
    expect(queued).toHaveLength(1)
    expect(queued[0].title).toBe('Task 2')
  })

  it('returns tasks ordered by priority then created_at', () => {
    createTask(db, { title: 'Low priority', repo: 'bde', priority: 2 })
    createTask(db, { title: 'High priority', repo: 'bde', priority: 0 })
    const all = listTasks(db)
    expect(all[0].title).toBe('High priority')
    expect(all[1].title).toBe('Low priority')
  })
})

describe('createTask', () => {
  it('creates a task with defaults', () => {
    const task = createTask(db, { title: 'New task', repo: 'bde' })
    expect(task.id).toBeTruthy()
    expect(task.title).toBe('New task')
    expect(task.repo).toBe('bde')
    expect(task.status).toBe('backlog')
    expect(task.priority).toBe(0)
    expect(task.prompt).toBe('New task') // defaults to title
  })

  it('creates a task with all fields', () => {
    const task = createTask(db, {
      title: 'Full task',
      repo: 'life-os',
      prompt: 'Do the thing',
      spec: '## Spec',
      notes: 'Some notes',
      priority: 5,
      status: 'queued',
      template_name: 'bugfix',
    })
    expect(task.title).toBe('Full task')
    expect(task.repo).toBe('life-os')
    expect(task.prompt).toBe('Do the thing')
    expect(task.spec).toBe('## Spec')
    expect(task.notes).toBe('Some notes')
    expect(task.priority).toBe(5)
    expect(task.status).toBe('queued')
    expect(task.template_name).toBe('bugfix')
  })
})

describe('updateTask', () => {
  it('updates allowed fields', () => {
    const task = createTask(db, { title: 'Original', repo: 'bde' })
    const updated = updateTask(db, task.id, { title: 'Updated', priority: 3 })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Updated')
    expect(updated!.priority).toBe(3)
  })

  it('returns null when no allowed fields provided', () => {
    const task = createTask(db, { title: 'Original', repo: 'bde' })
    const result = updateTask(db, task.id, { id: 'hacked', created_at: 'hacked' })
    expect(result).toBeNull()
  })

  it('filters out disallowed fields while keeping allowed ones', () => {
    const task = createTask(db, { title: 'Original', repo: 'bde' })
    const updated = updateTask(db, task.id, { title: 'Safe', id: 'hacked' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Safe')
    expect(updated!.id).toBe(task.id) // id not changed
  })

  it('returns null for non-existent task', () => {
    const result = updateTask(db, 'nonexistent', { title: 'Nope' })
    expect(result).toBeNull()
  })
})

describe('deleteTask', () => {
  it('removes the task from the database', () => {
    const task = createTask(db, { title: 'To delete', repo: 'bde' })
    expect(getTask(db, task.id)).not.toBeNull()
    deleteTask(db, task.id)
    expect(getTask(db, task.id)).toBeFalsy()
  })

  it('does nothing for non-existent task', () => {
    expect(() => deleteTask(db, 'nonexistent')).not.toThrow()
  })
})

describe('claimTask', () => {
  it('claims a queued task', () => {
    const task = createTask(db, { title: 'Claimable', repo: 'bde', status: 'queued' })
    const claimed = claimTask(db, task.id, 'executor-1')
    expect(claimed).not.toBeNull()
    expect(claimed!.status).toBe('active')
    expect(claimed!.claimed_by).toBe('executor-1')
    expect(claimed!.started_at).toBeTruthy()
  })

  it('returns null for non-queued task', () => {
    const task = createTask(db, { title: 'Not queued', repo: 'bde', status: 'backlog' })
    const result = claimTask(db, task.id, 'executor-1')
    expect(result).toBeNull()
  })
})

describe('releaseTask', () => {
  it('releases an active task back to queued', () => {
    const task = createTask(db, { title: 'Active', repo: 'bde', status: 'queued' })
    claimTask(db, task.id, 'executor-1')
    const released = releaseTask(db, task.id)
    expect(released).not.toBeNull()
    expect(released!.status).toBe('queued')
    expect(released!.claimed_by).toBeNull()
    expect(released!.started_at).toBeNull()
  })

  it('returns null for non-active task', () => {
    const task = createTask(db, { title: 'Backlog', repo: 'bde', status: 'backlog' })
    const result = releaseTask(db, task.id)
    expect(result).toBeNull()
  })
})

describe('getQueueStats', () => {
  it('returns zero counts when no tasks exist', () => {
    const stats = getQueueStats(db)
    expect(stats.backlog).toBe(0)
    expect(stats.queued).toBe(0)
    expect(stats.active).toBe(0)
    expect(stats.done).toBe(0)
  })

  it('counts tasks by status', () => {
    createTask(db, { title: 'A', repo: 'bde', status: 'backlog' })
    createTask(db, { title: 'B', repo: 'bde', status: 'backlog' })
    createTask(db, { title: 'C', repo: 'bde', status: 'queued' })
    const stats = getQueueStats(db)
    expect(stats.backlog).toBe(2)
    expect(stats.queued).toBe(1)
  })
})

describe('getDoneTodayCount', () => {
  it('returns 0 when no tasks done today', () => {
    expect(getDoneTodayCount(db)).toBe(0)
  })

  it('counts tasks completed today', () => {
    const task = createTask(db, { title: 'Done', repo: 'bde', status: 'done' })
    updateTask(db, task.id, { completed_at: new Date().toISOString() })
    expect(getDoneTodayCount(db)).toBe(1)
  })
})

describe('listTasksWithOpenPrs', () => {
  it('returns tasks with open PR status', () => {
    const task = createTask(db, { title: 'PR task', repo: 'bde' })
    updateTask(db, task.id, { pr_number: 42, pr_status: 'open' })
    const result = listTasksWithOpenPrs(db)
    expect(result).toHaveLength(1)
    expect(result[0].pr_number).toBe(42)
  })

  it('excludes tasks without open PRs', () => {
    createTask(db, { title: 'No PR', repo: 'bde' })
    const result = listTasksWithOpenPrs(db)
    expect(result).toHaveLength(0)
  })
})

describe('clearSprintTaskFk', () => {
  it('clears agent_run_id for matching tasks', () => {
    const task = createTask(db, { title: 'Linked', repo: 'bde' })
    updateTask(db, task.id, { agent_run_id: 'agent-123' })
    clearSprintTaskFk(db, 'agent-123')
    const updated = getTask(db, task.id)
    expect(updated!.agent_run_id).toBeNull()
  })
})

describe('UPDATE_ALLOWLIST', () => {
  it('contains expected fields', () => {
    expect(UPDATE_ALLOWLIST.has('title')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('status')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('pr_url')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('agent_run_id')).toBe(true)
  })

  it('does not contain protected fields', () => {
    expect(UPDATE_ALLOWLIST.has('id')).toBe(false)
    expect(UPDATE_ALLOWLIST.has('created_at')).toBe(false)
    expect(UPDATE_ALLOWLIST.has('updated_at')).toBe(false)
  })
})
