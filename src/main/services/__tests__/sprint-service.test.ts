/**
 * Sprint service layer unit tests.
 * Verifies that service wrappers delegate to sprint-queries
 * and fire mutation notifications on success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SprintTask, CreateTaskInput, QueueStats } from '../../../shared/types'

// Mock electron (for BrowserWindow used by broadcast)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }])
  }
}))

// broadcast is now injected via setSprintBroadcaster — no module-level mock needed

// Mock webhook-service
vi.mock('../webhook-service', () => ({
  createWebhookService: vi.fn(() => ({
    fireWebhook: vi.fn()
  })),
  getWebhookEventName: vi.fn((type, _task) => `sprint.task.${type}`)
}))

// Mock webhook-queries
vi.mock('../../data/webhook-queries', () => ({
  getWebhooks: vi.fn(() => [])
}))

// Mock logger
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

// sprint-mutations is the factory-injected layer (T-133). Bypass the factory
// guard by delegating to the sprint-queries mock below.
vi.mock('../sprint-mutations', async () => {
  const sq = await import('../../data/sprint-queries')
  return {
    getTask: (...a: unknown[]) => (sq.getTask as Function)(...a),
    updateTask: (...a: unknown[]) => (sq.updateTask as Function)(...a),
    forceUpdateTask: (...a: unknown[]) => (sq.forceUpdateTask as Function)(...a),
    listTasks: (...a: unknown[]) => (sq.listTasks as Function)(...a),
    listTasksRecent: (...a: unknown[]) => (sq.listTasksRecent as Function)(...a),
    createTask: (...a: unknown[]) => (sq.createTask as Function)(...a),
    deleteTask: (...a: unknown[]) => (sq.deleteTask as Function)(...a),
    claimTask: (...a: unknown[]) => (sq.claimTask as Function)(...a),
    releaseTask: (...a: unknown[]) => (sq.releaseTask as Function)(...a),
    getQueueStats: (...a: unknown[]) => (sq.getQueueStats as Function)(...a),
    getDoneTodayCount: (...a: unknown[]) => (sq.getDoneTodayCount as Function)(...a),
    listTasksWithOpenPrs: (...a: unknown[]) => (sq.listTasksWithOpenPrs as Function)(...a),
    getHealthCheckTasks: (...a: unknown[]) => (sq.getHealthCheckTasks as Function)(...a),
    getSuccessRateBySpecType: (...a: unknown[]) => (sq.getSuccessRateBySpecType as Function)(...a),
    getDailySuccessRate: (...a: unknown[]) => (sq.getDailySuccessRate as Function)(...a),
    markTaskDoneByPrNumber: (...a: unknown[]) => (sq.markTaskDoneByPrNumber as Function)(...a),
    markTaskCancelledByPrNumber: (...a: unknown[]) => (sq.markTaskCancelledByPrNumber as Function)(...a),
    updateTaskMergeableState: (...a: unknown[]) => (sq.updateTaskMergeableState as Function)(...a),
    flagStuckTasks: (...a: unknown[]) => (sq.flagStuckTasks as Function)(...a),
    createReviewTaskFromAdhoc: (...a: unknown[]) => (sq.createReviewTaskFromAdhoc as Function)(...a),
    createSprintMutations: vi.fn()
  }
})

// Mock sprint-queries (data layer)
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title', 'status', 'prompt', 'spec', 'notes']),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  // Additional methods needed by ISprintTaskRepository
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn()
}))

// Mock reporting-queries (reporting/analytics layer)
vi.mock('../../data/reporting-queries', () => ({
  getDoneTodayCount: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn()
}))

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
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState,
  getHealthCheckTasks,
  resetTaskForRetry
} from '../sprint-service'

import {
  getTask as _getTask,
  listTasks as _listTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  claimTask as _claimTask,
  releaseTask as _releaseTask,
  getQueueStats as _getQueueStats,
  markTaskDoneByPrNumber as _markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber as _markTaskCancelledByPrNumber,
  listTasksWithOpenPrs as _listTasksWithOpenPrs,
  updateTaskMergeableState as _updateTaskMergeableState,
  getHealthCheckTasks as _getHealthCheckTasks
} from '../../data/sprint-queries'

// getDoneTodayCount now routes through sprint-mutations → sprint-queries (T-133)
import { getDoneTodayCount as _getDoneTodayCount } from '../../data/sprint-queries'

import { setSprintBroadcaster } from '../sprint-mutation-broadcaster'

const mockBroadcastFn = vi.fn()

describe('sprint-service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockBroadcastFn.mockReset()
    setSprintBroadcaster(mockBroadcastFn)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getTask', () => {
    it('delegates to sprint-queries', () => {
      const task: Partial<SprintTask> = { id: '1', title: 'Test' }
      vi.mocked(_getTask).mockReturnValue(task as SprintTask)
      expect(getTask('1')).toEqual(task)
      expect(_getTask).toHaveBeenCalledWith('1')
    })

    it('returns null when task not found', () => {
      vi.mocked(_getTask).mockReturnValue(null)
      expect(getTask('missing')).toBeNull()
    })
  })

  describe('listTasks', () => {
    it('delegates to sprint-queries with optional status filter', () => {
      const tasks: Partial<SprintTask>[] = [{ id: '1' }, { id: '2' }]
      vi.mocked(_listTasks).mockReturnValue(tasks as SprintTask[])
      expect(listTasks('queued')).toEqual(tasks)
      expect(_listTasks).toHaveBeenCalledWith('queued')
    })

    it('passes no args when no status filter', () => {
      vi.mocked(_listTasks).mockReturnValue([])
      listTasks()
      // sprint-service re-exports mutations.listTasks which calls sprint-queries
      // directly — no explicit undefined argument is added
      expect(_listTasks).toHaveBeenCalledWith()
    })
  })

  describe('createTask', () => {
    it('creates task and fires created notification', async () => {
      const input: Partial<CreateTaskInput> = { title: 'New', repo: 'bde' }
      const created: Partial<SprintTask> = { id: 'abc', ...input }
      vi.mocked(_createTask).mockResolvedValue(created as SprintTask)

      const result = await createTask(input as CreateTaskInput)
      expect(result).toEqual(created)
      expect(_createTask).toHaveBeenCalledWith(input)
      vi.runAllTimers()
      expect(mockBroadcastFn).toHaveBeenCalled()
    })

    it('does not notify when createTask returns null', async () => {
      vi.mocked(_createTask).mockResolvedValue(null)
      const result = await createTask({ title: 'Bad', repo: 'bde' } as CreateTaskInput)
      expect(result).toBeNull()
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })
  })

  describe('updateTask', () => {
    it('updates task and fires updated notification', async () => {
      const updated: Partial<SprintTask> = { id: '1', title: 'Updated' }
      vi.mocked(_updateTask).mockResolvedValue(updated as SprintTask)

      const result = await updateTask('1', { title: 'Updated' })
      expect(result).toEqual(updated)
      expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' }, undefined)
      vi.runAllTimers()
      expect(mockBroadcastFn).toHaveBeenCalled() // updated)
    })

    it('forwards the optional caller attribution to the data layer', async () => {
      const updated: Partial<SprintTask> = { id: '1', title: 'Updated' }
      vi.mocked(_updateTask).mockResolvedValue(updated as SprintTask)

      await updateTask('1', { title: 'Updated' }, { caller: 'mcp' })
      expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' }, { caller: 'mcp' })
    })

    it('does not notify when updateTask returns null', async () => {
      vi.mocked(_updateTask).mockResolvedValue(null)
      const result = await updateTask('missing', { title: 'X' })
      expect(result).toBeNull()
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('deletes task and fires deleted notification', () => {
      const task: Partial<SprintTask> = { id: '1', title: 'Doomed' }
      vi.mocked(_getTask).mockReturnValue(task as SprintTask)

      deleteTask('1')
      expect(_deleteTask).toHaveBeenCalledWith('1')
      vi.runAllTimers()
      expect(mockBroadcastFn).toHaveBeenCalled()
    })

    it('does not notify when task not found before delete', () => {
      vi.mocked(_getTask).mockReturnValue(null)
      deleteTask('missing')
      expect(_deleteTask).toHaveBeenCalledWith('missing')
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })
  })

  describe('claimTask', () => {
    it('claims task and fires updated notification', async () => {
      const claimed: Partial<SprintTask> = { id: '1', claimed_by: 'agent-1' }
      vi.mocked(_claimTask).mockResolvedValue(claimed as SprintTask)

      const result = await claimTask('1', 'agent-1')
      expect(result).toEqual(claimed)
      // sprint-service re-exports mutations.claimTask which does not pass a third arg
      expect(_claimTask).toHaveBeenCalledWith('1', 'agent-1')
      vi.runAllTimers()
      expect(mockBroadcastFn).toHaveBeenCalled()
    })

    it('does not notify when claim fails', async () => {
      vi.mocked(_claimTask).mockResolvedValue(null)
      const result = await claimTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })
  })

  describe('releaseTask', () => {
    it('releases task and fires updated notification', async () => {
      const released: Partial<SprintTask> = { id: '1', claimed_by: null }
      vi.mocked(_releaseTask).mockResolvedValue(released as SprintTask)

      const result = await releaseTask('1', 'agent-1')
      expect(result).toEqual(released)
      expect(_releaseTask).toHaveBeenCalledWith('1', 'agent-1')
      vi.runAllTimers()
      expect(mockBroadcastFn).toHaveBeenCalled() // released)
    })

    it('does not notify when release fails', async () => {
      vi.mocked(_releaseTask).mockResolvedValue(null)
      const result = await releaseTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })
  })

  describe('passthrough functions', () => {
    it('getQueueStats delegates without notification', () => {
      const stats: Partial<QueueStats> = { queued: 5, active: 2 }
      vi.mocked(_getQueueStats).mockReturnValue(stats as QueueStats)
      expect(getQueueStats()).toEqual(stats)
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })

    it('getDoneTodayCount delegates without notification', () => {
      vi.mocked(_getDoneTodayCount).mockReturnValue(3)
      expect(getDoneTodayCount()).toBe(3)
    })

    it('markTaskDoneByPrNumber delegates without notification', async () => {
      vi.mocked(_markTaskDoneByPrNumber).mockResolvedValue(['t1'])
      expect(await markTaskDoneByPrNumber(42)).toEqual(['t1'])
    })

    it('markTaskCancelledByPrNumber delegates without notification', async () => {
      vi.mocked(_markTaskCancelledByPrNumber).mockResolvedValue(['t2'])
      expect(await markTaskCancelledByPrNumber(99)).toEqual(['t2'])
    })

    it('listTasksWithOpenPrs delegates without notification', () => {
      const tasks: Partial<SprintTask>[] = [{ id: '1' }]
      vi.mocked(_listTasksWithOpenPrs).mockReturnValue(tasks as SprintTask[])
      expect(listTasksWithOpenPrs()).toEqual([{ id: '1' }])
    })

    it('updateTaskMergeableState delegates without notification', async () => {
      vi.mocked(_updateTaskMergeableState).mockResolvedValue(undefined)
      await updateTaskMergeableState(42, 'clean')
      expect(_updateTaskMergeableState).toHaveBeenCalledWith(42, 'clean')
      expect(mockBroadcastFn).not.toHaveBeenCalled()
    })

    it('getHealthCheckTasks delegates without notification', () => {
      const tasks: Partial<SprintTask>[] = [{ id: '1' }]
      vi.mocked(_getHealthCheckTasks).mockReturnValue(tasks as SprintTask[])
      expect(getHealthCheckTasks()).toEqual([{ id: '1' }])
    })
  })

  describe('resetTaskForRetry', () => {
    it('clears all stale terminal-state fields', () => {
      const updateTask = vi.fn().mockReturnValue({ id: 't1' } as any)
      resetTaskForRetry('t1', { updateTask })
      expect(updateTask).toHaveBeenCalledWith('t1', {
        completed_at: null,
        failure_reason: null,
        claimed_by: null,
        started_at: null,
        retry_count: 0,
        fast_fail_count: 0,
        next_eligible_at: null
      })
    })

    it('does not set status — caller decides queued vs backlog', () => {
      const updateTask = vi.fn().mockReturnValue({ id: 't1' } as any)
      resetTaskForRetry('t1', { updateTask })
      const patch = updateTask.mock.calls[0][1]
      expect(patch).not.toHaveProperty('status')
    })

    it('returns the updated row', () => {
      const row = { id: 't1', status: 'queued' } as any
      const updateTask = vi.fn().mockReturnValue(row)
      expect(resetTaskForRetry('t1', { updateTask })).toBe(row)
    })

    it('returns null when updateTask returns null', () => {
      const updateTask = vi.fn().mockReturnValue(null)
      expect(resetTaskForRetry('missing', { updateTask })).toBeNull()
    })
  })
})
