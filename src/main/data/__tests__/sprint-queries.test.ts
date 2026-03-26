import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  getQueuedTasks,
  getOrphanedTasks,
  getTasksWithDependencies,
  getActiveTaskCount,
  UPDATE_ALLOWLIST,
} from '../sprint-queries'

// --- Mock the Supabase client ---

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

function chainable(terminal?: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'not', 'gte', 'lt', 'order', 'single', 'maybeSingle', 'limit', 'is']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  if (terminal) {
    Object.assign(chain, terminal)
  }
  return chain
}

function makeFrom() {
  return vi.fn().mockImplementation(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  }))
}

const mockFrom = makeFrom()

vi.mock('../supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

beforeEach(() => {
  vi.clearAllMocks()
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

describe('getTask', () => {
  it('returns null for non-existent task', async () => {
    const chain = chainable()
    ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await getTask('nonexistent')
    expect(result).toBeNull()
  })

  it('returns the task when it exists', async () => {
    const task = { id: 'abc', title: 'Test task', repo: 'bde' }
    const chain = chainable()
    ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: task, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await getTask('abc')
    // sanitizeTask adds depends_on: null when not present
    expect(result).toEqual({ ...task, depends_on: null })
  })
})

describe('listTasks', () => {
  it('returns all tasks when no status filter', async () => {
    const tasks = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }]
    const chain = chainable()
    // First .order() returns the chain; second .order() resolves the data
    ;(chain.order as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain)
      .mockResolvedValue({ data: tasks, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await listTasks()
    expect(result).toHaveLength(2)
  })

  it('returns only tasks matching status filter', async () => {
    const tasks = [{ id: '2', title: 'B', status: 'queued' }]
    const chain = chainable()
    // Both .order() calls return the chain; .eq() is the terminal call
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ data: tasks, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await listTasks('queued')
    expect(result).toHaveLength(1)
  })
})

describe('createTask', () => {
  it('creates a task with defaults', async () => {
    const task = { id: 'new1', title: 'New task', repo: 'bde', status: 'backlog', priority: 0 }
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: task, error: null })
    mockInsert.mockReturnValue(chain)

    const result = await createTask({ title: 'New task', repo: 'bde' })
    expect(result.title).toBe('New task')
    expect(result.repo).toBe('bde')
  })

  it('returns null on insert error', async () => {
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'insert failed' },
    })
    mockInsert.mockReturnValue(chain)

    const result = await createTask({ title: 'Fail', repo: 'bde' })
    expect(result).toBeNull()
  })
})

describe('updateTask', () => {
  it('returns null when no allowed fields provided', async () => {
    const result = await updateTask('abc', { id: 'hacked', created_at: 'hacked' })
    expect(result).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('updates allowed fields', async () => {
    const updated = { id: 'abc', title: 'Updated', priority: 3 }
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: updated, error: null })
    mockUpdate.mockReturnValue(chain)

    const result = await updateTask('abc', { title: 'Updated', priority: 3 })
    // sanitizeTask adds depends_on: null when not present
    expect(result).toEqual({ ...updated, depends_on: null })
  })
})

describe('deleteTask', () => {
  it('does not throw for non-existent task', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
    mockDelete.mockReturnValue(chain)

    await expect(deleteTask('nonexistent')).resolves.not.toThrow()
  })
})

describe('claimTask', () => {
  it('claims a queued task', async () => {
    const claimed = { id: 't1', status: 'active', claimed_by: 'exec-1' }
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: claimed, error: null })
    mockUpdate.mockReturnValue(chain)

    const result = await claimTask('t1', 'exec-1')
    // sanitizeTask adds depends_on: null when not present
    expect(result).toEqual({ ...claimed, depends_on: null })
  })

  it('returns null for non-queued task', async () => {
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    })
    mockUpdate.mockReturnValue(chain)

    const result = await claimTask('t1', 'exec-1')
    expect(result).toBeNull()
  })
})

describe('releaseTask', () => {
  it('releases an active task back to queued', async () => {
    const released = { id: 't1', status: 'queued', claimed_by: null }
    const chain = chainable()
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: released, error: null })
    mockUpdate.mockReturnValue(chain)

    const result = await releaseTask('t1', 'exec-1')
    // sanitizeTask adds depends_on: null when not present
    expect(result).toEqual({ ...released, depends_on: null })
  })
})

describe('getQueueStats', () => {
  it('returns zero counts when no tasks exist', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })

    const stats = await getQueueStats()
    expect(stats.backlog).toBe(0)
    expect(stats.queued).toBe(0)
    expect(stats.active).toBe(0)
    expect(stats.done).toBe(0)
  })

  it('counts tasks by status', async () => {
    mockSelect.mockResolvedValue({
      data: [{ status: 'backlog' }, { status: 'backlog' }, { status: 'queued' }],
      error: null,
    })

    const stats = await getQueueStats()
    expect(stats.backlog).toBe(2)
    expect(stats.queued).toBe(1)
  })
})

describe('getDoneTodayCount', () => {
  it('returns 0 when no tasks done today', async () => {
    const chain = chainable()
    ;(chain.gte as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, error: null })
    mockSelect.mockReturnValue(chain)

    const count = await getDoneTodayCount()
    expect(count).toBe(0)
  })
})

describe('listTasksWithOpenPrs', () => {
  it('returns tasks with open PR status', async () => {
    const tasks = [{ id: 't1', pr_number: 42, pr_status: 'open' }]
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ data: tasks, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await listTasksWithOpenPrs()
    expect(result).toHaveLength(1)
  })
})

describe('clearSprintTaskFk', () => {
  it('does not throw', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
    mockUpdate.mockReturnValue(chain)

    await expect(clearSprintTaskFk('agent-123')).resolves.not.toThrow()
  })
})

describe('getQueuedTasks', () => {
  it('returns empty array on error instead of throwing', async () => {
    const chain = chainable()
    ;(chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    })
    mockSelect.mockReturnValue(chain)

    const result = await getQueuedTasks(5)
    expect(result).toEqual([])
  })

  it('returns tasks on success', async () => {
    const tasks = [{ id: 't1', status: 'queued' }]
    const chain = chainable()
    ;(chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: tasks, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await getQueuedTasks(5)
    expect(result).toHaveLength(1)
  })
})

describe('getOrphanedTasks', () => {
  it('returns empty array on error instead of throwing', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain) // .eq('status', 'active')
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } }) // .eq('claimed_by', ...)
    mockSelect.mockReturnValue(chain)

    const result = await getOrphanedTasks('exec-1')
    expect(result).toEqual([])
  })

  it('returns tasks on success', async () => {
    const tasks = [{ id: 't1', status: 'active', claimed_by: 'exec-1' }]
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain) // .eq('status', 'active')
      .mockResolvedValueOnce({ data: tasks, error: null }) // .eq('claimed_by', ...)
    mockSelect.mockReturnValue(chain)

    const result = await getOrphanedTasks('exec-1')
    expect(result).toHaveLength(1)
  })
})

describe('getTasksWithDependencies', () => {
  it('returns empty array on error instead of throwing', async () => {
    const chain = chainable()
    ;(chain.not as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'query failed' },
    })
    mockSelect.mockReturnValue(chain)

    const result = await getTasksWithDependencies()
    expect(result).toEqual([])
  })

  it('returns tasks with dependencies on success', async () => {
    const tasks = [{ id: 't1', depends_on: [{ id: 't0', type: 'hard' }], status: 'blocked' }]
    const chain = chainable()
    ;(chain.not as ReturnType<typeof vi.fn>).mockResolvedValue({ data: tasks, error: null })
    mockSelect.mockReturnValue(chain)

    const result = await getTasksWithDependencies()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })
})

describe('getActiveTaskCount', () => {
  it('returns count of active tasks', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3, error: null })
    mockSelect.mockReturnValue(chain)

    const count = await getActiveTaskCount()
    expect(count).toBe(3)
  })

  it('returns Infinity on error (fail-closed)', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: null,
      error: { message: 'connection refused' },
    })
    mockSelect.mockReturnValue(chain)

    const count = await getActiveTaskCount()
    expect(count).toBe(Infinity)
  })

  it('returns 0 when count is null and no error', async () => {
    const chain = chainable()
    ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ count: null, error: null })
    mockSelect.mockReturnValue(chain)

    const count = await getActiveTaskCount()
    expect(count).toBe(0)
  })
})
