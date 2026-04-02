/**
 * Integration test: Sprint CRUD operations through the handler layer.
 *
 * Mocks at the sprint-queries (Supabase) level and calls handler functions
 * directly — the same path used by IPC from the renderer, minus Electron.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockListTasks = vi.fn()
const mockGetTask = vi.fn()
const mockCreateTask = vi.fn()
const mockUpdateTask = vi.fn()
const mockDeleteTask = vi.fn()
const mockClaimTask = vi.fn()
const mockReleaseTask = vi.fn()
const mockGetQueueStats = vi.fn()
const mockGetDoneTodayCount = vi.fn()
const mockMarkTaskDoneByPrNumber = vi.fn()
const mockMarkTaskCancelledByPrNumber = vi.fn()
const mockListTasksWithOpenPrs = vi.fn()
const mockUpdateTaskMergeableState = vi.fn()
const mockGetHealthCheckTasks = vi.fn()

vi.mock('../../data/sprint-queries', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  claimTask: (...args: unknown[]) => mockClaimTask(...args),
  releaseTask: (...args: unknown[]) => mockReleaseTask(...args),
  getQueueStats: (...args: unknown[]) => mockGetQueueStats(...args),
  getDoneTodayCount: (...args: unknown[]) => mockGetDoneTodayCount(...args),
  markTaskDoneByPrNumber: (...args: unknown[]) => mockMarkTaskDoneByPrNumber(...args),
  markTaskCancelledByPrNumber: (...args: unknown[]) => mockMarkTaskCancelledByPrNumber(...args),
  listTasksWithOpenPrs: (...args: unknown[]) => mockListTasksWithOpenPrs(...args),
  updateTaskMergeableState: (...args: unknown[]) => mockUpdateTaskMergeableState(...args),
  getHealthCheckTasks: (...args: unknown[]) => mockGetHealthCheckTasks(...args),
  UPDATE_ALLOWLIST: new Set([
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
    'playground_enabled'
  ])
}))

vi.mock('../../agent-manager/dependency-index', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    getDependents: vi.fn(() => new Set()),
    areDependenciesSatisfied: vi.fn(() => ({ satisfied: true, blockedBy: [] }))
  })),
  detectCycle: vi.fn(() => null)
}))

// Mock sprint-listeners — suppress SSE broadcasting
vi.mock('../../handlers/sprint-listeners', () => ({
  notifySprintMutation: vi.fn()
}))

// Mock spec-semantic-check
vi.mock('../../spec-semantic-check', () => ({
  checkSpecSemantic: vi.fn().mockResolvedValue({ passed: true, failMessages: [] })
}))

// Mock Electron ipcMain.handle — capture registered handlers
const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler)
    })
  }
}))

// Mock getDb (used by sprint:readLog)
vi.mock('../../db', () => ({
  getDb: vi.fn(() => ({}))
}))

// Mock agent-queries and agent-history (used by sprint:readLog)
vi.mock('../../data/agent-queries', () => ({
  getAgentLogInfo: vi.fn(() => null)
}))

vi.mock('../../agent-history', () => ({
  readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 })
}))

// Mock settings (used by sprint:claimTask)
vi.mock('../../settings', () => ({
  getSetting: vi.fn().mockReturnValue(null),
  setSetting: vi.fn(),
  getSettingJson: vi.fn().mockReturnValue(null)
}))

// Mock sprint-spec (used by sprint:generatePrompt and sprint:readSpecFile)
vi.mock('../../handlers/sprint-spec', () => ({
  generatePrompt: vi.fn().mockResolvedValue({ prompt: 'generated prompt', spec: null }),
  validateSpecPath: vi.fn((p: string) => p)
}))

// Mock fs/promises (used by sprint:readSpecFile)
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# Spec content')
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerSprintLocalHandlers } from '../../handlers/sprint-local'
import type { SprintTask } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Invoke a registered IPC handler by channel name. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  // First arg is always the IpcMainInvokeEvent — pass a dummy
  return handler({} as Electron.IpcMainInvokeEvent, ...args)
}

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-001',
    title: 'Fix login bug',
    repo: 'BDE',
    prompt: 'Fix the login bug in auth module',
    priority: 0,
    status: 'backlog',
    notes: null,
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    playground_enabled: false,
    updated_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sprint IPC handlers — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
    registerSprintLocalHandlers()
  })

  // 1. Create task → returns task with ID and all fields
  describe('sprint:create', () => {
    it('creates a task and returns it with all fields', async () => {
      const created = makeTask({ id: 'task-new', status: 'backlog' })
      mockCreateTask.mockReturnValue(created)

      const result = await invoke('sprint:create', {
        title: 'Fix login bug',
        repo: 'BDE',
        status: 'backlog'
      })

      expect(result).toEqual(created)
      expect(mockCreateTask).toHaveBeenCalledOnce()
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fix login bug', repo: 'BDE' })
      )
    })

    it('rejects creation when title is missing', async () => {
      await expect(invoke('sprint:create', { title: '', repo: 'BDE' })).rejects.toThrow(
        'Spec quality checks failed'
      )
    })

    it('rejects creation when repo is missing', async () => {
      await expect(invoke('sprint:create', { title: 'Some task', repo: '' })).rejects.toThrow(
        'Spec quality checks failed'
      )
    })
  })

  // 2. List tasks → returns array including created task
  describe('sprint:list', () => {
    it('returns an array of tasks', async () => {
      const tasks = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]
      mockListTasks.mockReturnValue(tasks)

      const result = await invoke('sprint:list')

      expect(result).toEqual(tasks)
      expect(result).toHaveLength(2)
      expect(mockListTasks).toHaveBeenCalledOnce()
    })

    it('returns empty array when no tasks exist', async () => {
      mockListTasks.mockReturnValue([])
      const result = await invoke('sprint:list')
      expect(result).toEqual([])
    })
  })

  // 3. Update task fields → returns updated task with correct shape
  describe('sprint:update', () => {
    it('updates task fields and returns the updated task', async () => {
      const updated = makeTask({ id: 'task-001', title: 'Updated title', notes: 'New notes' })
      mockUpdateTask.mockReturnValue(updated)

      const result = await invoke('sprint:update', 'task-001', {
        title: 'Updated title',
        notes: 'New notes'
      })

      expect(result).toEqual(updated)
      expect(mockUpdateTask).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({ title: 'Updated title', notes: 'New notes' })
      )
    })
  })

  // 4. Update task status → validates transition, returns updated task
  describe('sprint:update — status transitions', () => {
    it('transitions backlog → queued with valid spec (passes quality checks)', async () => {
      const specText = [
        '## Problem',
        'The login page does not handle expired tokens correctly.',
        '',
        '## Solution',
        'Add token refresh logic before redirecting to the login page.'
      ].join('\n')

      const existing = makeTask({ id: 'task-001', status: 'backlog', spec: specText })
      const updated = makeTask({ id: 'task-001', status: 'queued', spec: specText })
      mockGetTask.mockReturnValue(existing)
      mockUpdateTask.mockReturnValue(updated)

      const result = await invoke('sprint:update', 'task-001', { status: 'queued' })

      expect(result).toEqual(updated)
    })

    it('rejects transition to queued when spec is missing', async () => {
      const existing = makeTask({ id: 'task-001', status: 'backlog', spec: null })
      mockGetTask.mockReturnValue(existing)

      await expect(invoke('sprint:update', 'task-001', { status: 'queued' })).rejects.toThrow(
        'Cannot queue task'
      )
    })
  })

  // 5. Delete task → returns success
  describe('sprint:delete', () => {
    it('deletes a task and returns ok', async () => {
      const task = makeTask({ id: 'task-del' })
      mockGetTask.mockReturnValue(task)
      mockDeleteTask.mockReturnValue(undefined)

      const result = await invoke('sprint:delete', 'task-del')

      expect(result).toEqual({ ok: true })
      expect(mockDeleteTask).toHaveBeenCalledWith('task-del')
    })
  })

  // 6. Create task with dependencies → auto-blocks if deps unsatisfied
  describe('sprint:create — dependency auto-blocking', () => {
    const validSpec = [
      '## Problem',
      'The login page does not handle expired tokens correctly.',
      '',
      '## Solution',
      'Add token refresh logic before redirecting to the login page.'
    ].join('\n')

    it('auto-blocks a queued task when dependencies are unsatisfied', async () => {
      const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
      const mockIdx = {
        rebuild: vi.fn(),
        getDependents: vi.fn(() => new Set()),
        areDependenciesSatisfied: vi.fn(() => ({
          satisfied: false,
          blockedBy: ['dep-task-1']
        }))
      }
      vi.mocked(createDependencyIndex).mockReturnValue(mockIdx as any)

      // listTasks is called to build the status map for dependency checking
      mockListTasks.mockReturnValue([makeTask({ id: 'dep-task-1', status: 'backlog' })])

      const blockedTask = makeTask({
        id: 'task-blocked',
        status: 'blocked',
        spec: validSpec,
        depends_on: [{ id: 'dep-task-1', type: 'hard' }],
        notes: '[auto-block] Blocked by: dep-task-1'
      })
      mockCreateTask.mockReturnValue(blockedTask)

      const result = await invoke('sprint:create', {
        title: 'Depends on another',
        repo: 'BDE',
        spec: validSpec,
        status: 'queued',
        depends_on: [{ id: 'dep-task-1', type: 'hard' }]
      })

      expect(result).toEqual(blockedTask)
      // The handler should pass status: 'blocked' to createTask
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' }))
    })

    it('allows queued task when all dependencies are satisfied', async () => {
      const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
      const mockIdx = {
        rebuild: vi.fn(),
        getDependents: vi.fn(() => new Set()),
        areDependenciesSatisfied: vi.fn(() => ({
          satisfied: true,
          blockedBy: []
        }))
      }
      vi.mocked(createDependencyIndex).mockReturnValue(mockIdx as any)

      mockListTasks.mockReturnValue([makeTask({ id: 'dep-task-1', status: 'done' })])

      const queuedTask = makeTask({
        id: 'task-queued',
        status: 'queued',
        spec: validSpec,
        depends_on: [{ id: 'dep-task-1', type: 'hard' }]
      })
      mockCreateTask.mockReturnValue(queuedTask)

      const result = await invoke('sprint:create', {
        title: 'Depends on done task',
        repo: 'BDE',
        spec: validSpec,
        status: 'queued',
        depends_on: [{ id: 'dep-task-1', type: 'hard' }]
      })

      expect(result).toEqual(queuedTask)
      // Should remain queued since dependency is satisfied
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }))
    })
  })

  // 7. Error handling → handler returns structured error on failure
  describe('error handling', () => {
    it('propagates errors from the data layer through safeHandle', async () => {
      mockListTasks.mockImplementation(() => {
        throw new Error('DB connection failed')
      })

      await expect(invoke('sprint:list')).rejects.toThrow('DB connection failed')
    })

    it('propagates create errors', async () => {
      mockCreateTask.mockImplementation(() => {
        throw new Error('Insert failed: duplicate key')
      })

      await expect(invoke('sprint:create', { title: 'Dup task', repo: 'BDE' })).rejects.toThrow(
        'Insert failed: duplicate key'
      )
    })
  })

  // Additional handler coverage
  describe('sprint:unblockTask', () => {
    it('unblocks a blocked task to queued', async () => {
      const validSpec = [
        '## Problem',
        'The blocked task needs to be unblocked manually.',
        '',
        '## Solution',
        'Transition the task from blocked to queued status.'
      ].join('\n')
      const blocked = makeTask({ id: 'task-blk', status: 'blocked', spec: validSpec })
      const unblocked = makeTask({ id: 'task-blk', status: 'queued', spec: validSpec })
      mockGetTask.mockReturnValue(blocked)
      mockUpdateTask.mockReturnValue(unblocked)

      const result = await invoke('sprint:unblockTask', 'task-blk')

      expect(result).toEqual(unblocked)
      expect(mockUpdateTask).toHaveBeenCalledWith('task-blk', { status: 'queued' })
    })

    it('throws if task is not blocked', async () => {
      const active = makeTask({ id: 'task-act', status: 'active' })
      mockGetTask.mockReturnValue(active)

      await expect(invoke('sprint:unblockTask', 'task-act')).rejects.toThrow('not blocked')
    })

    it('throws if task does not exist', async () => {
      mockGetTask.mockReturnValue(null)

      await expect(invoke('sprint:unblockTask', 'task-missing')).rejects.toThrow('not found')
    })
  })

  describe('sprint:healthCheck', () => {
    it('returns long-running active tasks', async () => {
      const stale = [makeTask({ id: 'task-stale', status: 'active' })]
      mockGetHealthCheckTasks.mockReturnValue(stale)

      const result = await invoke('sprint:healthCheck')

      expect(result).toEqual(stale)
      expect(mockGetHealthCheckTasks).toHaveBeenCalledOnce()
    })
  })

  describe('sprint:validateDependencies', () => {
    it('returns valid when deps exist and no cycle', async () => {
      mockGetTask.mockReturnValue(makeTask({ id: 'dep-1' }))
      mockListTasks.mockReturnValue([makeTask({ id: 'dep-1' })])

      const result = await invoke('sprint:validateDependencies', 'task-001', [
        { id: 'dep-1', type: 'hard' }
      ])

      expect(result).toEqual({ valid: true })
    })

    it('returns invalid when dep target does not exist', async () => {
      mockGetTask.mockReturnValue(null)

      const result = await invoke('sprint:validateDependencies', 'task-001', [
        { id: 'nonexistent', type: 'hard' }
      ])

      expect(result).toEqual({ valid: false, error: 'Task nonexistent not found' })
    })
  })
})
