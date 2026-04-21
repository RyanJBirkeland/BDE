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

// Mock broadcast
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

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

import { getDoneTodayCount as _getDoneTodayCount } from '../../data/reporting-queries'

import { broadcast } from '../../broadcast'

describe('sprint-service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
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

    it('passes undefined when no status filter', () => {
      vi.mocked(_listTasks).mockReturnValue([])
      listTasks()
      expect(_listTasks).toHaveBeenCalledWith(undefined)
    })
  })

  describe('createTask', () => {
    it('creates task and fires created notification', () => {
      const input: Partial<CreateTaskInput> = { title: 'New', repo: 'bde' }
      const created: Partial<SprintTask> = { id: 'abc', ...input }
      vi.mocked(_createTask).mockReturnValue(created as SprintTask)

      const result = createTask(input as CreateTaskInput)
      expect(result).toEqual(created)
      expect(_createTask).toHaveBeenCalledWith(input)
      vi.runAllTimers()
      expect(broadcast).toHaveBeenCalledWith('sprint:externalChange')
    })

    it('does not notify when createTask returns null', () => {
      vi.mocked(_createTask).mockReturnValue(null)
      const result = createTask({ title: 'Bad', repo: 'bde' } as CreateTaskInput)
      expect(result).toBeNull()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('updateTask', () => {
    it('updates task and fires updated notification', () => {
      const updated: Partial<SprintTask> = { id: '1', title: 'Updated' }
      vi.mocked(_updateTask).mockReturnValue(updated as SprintTask)

      const result = updateTask('1', { title: 'Updated' })
      expect(result).toEqual(updated)
      expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' }, undefined)
      vi.runAllTimers()
      expect(broadcast).toHaveBeenCalledWith('sprint:externalChange') // updated)
    })

    it('forwards the optional caller attribution to the data layer', () => {
      const updated: Partial<SprintTask> = { id: '1', title: 'Updated' }
      vi.mocked(_updateTask).mockReturnValue(updated as SprintTask)

      updateTask('1', { title: 'Updated' }, { caller: 'mcp' })
      expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' }, { caller: 'mcp' })
    })

    it('does not notify when updateTask returns null', () => {
      vi.mocked(_updateTask).mockReturnValue(null)
      const result = updateTask('missing', { title: 'X' })
      expect(result).toBeNull()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('deletes task and fires deleted notification', () => {
      const task: Partial<SprintTask> = { id: '1', title: 'Doomed' }
      vi.mocked(_getTask).mockReturnValue(task as SprintTask)

      deleteTask('1')
      expect(_deleteTask).toHaveBeenCalledWith('1')
      vi.runAllTimers()
      expect(broadcast).toHaveBeenCalledWith('sprint:externalChange')
    })

    it('does not notify when task not found before delete', () => {
      vi.mocked(_getTask).mockReturnValue(null)
      deleteTask('missing')
      expect(_deleteTask).toHaveBeenCalledWith('missing')
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('claimTask', () => {
    it('claims task and fires updated notification', () => {
      const claimed: Partial<SprintTask> = { id: '1', claimed_by: 'agent-1' }
      vi.mocked(_claimTask).mockReturnValue(claimed as SprintTask)

      const result = claimTask('1', 'agent-1')
      expect(result).toEqual(claimed)
      expect(_claimTask).toHaveBeenCalledWith('1', 'agent-1', undefined)
      vi.runAllTimers()
      expect(broadcast).toHaveBeenCalledWith('sprint:externalChange') // claimed)
    })

    it('does not notify when claim fails', () => {
      vi.mocked(_claimTask).mockReturnValue(null)
      const result = claimTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('releaseTask', () => {
    it('releases task and fires updated notification', () => {
      const released: Partial<SprintTask> = { id: '1', claimed_by: null }
      vi.mocked(_releaseTask).mockReturnValue(released as SprintTask)

      const result = releaseTask('1', 'agent-1')
      expect(result).toEqual(released)
      expect(_releaseTask).toHaveBeenCalledWith('1', 'agent-1')
      vi.runAllTimers()
      expect(broadcast).toHaveBeenCalledWith('sprint:externalChange') // released)
    })

    it('does not notify when release fails', () => {
      vi.mocked(_releaseTask).mockReturnValue(null)
      const result = releaseTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('passthrough functions', () => {
    it('getQueueStats delegates without notification', () => {
      const stats: Partial<QueueStats> = { queued: 5, active: 2 }
      vi.mocked(_getQueueStats).mockReturnValue(stats as QueueStats)
      expect(getQueueStats()).toEqual(stats)
      expect(broadcast).not.toHaveBeenCalled()
    })

    it('getDoneTodayCount delegates without notification', () => {
      vi.mocked(_getDoneTodayCount).mockReturnValue(3)
      expect(getDoneTodayCount()).toBe(3)
    })

    it('markTaskDoneByPrNumber delegates without notification', () => {
      vi.mocked(_markTaskDoneByPrNumber).mockReturnValue(['t1'])
      expect(markTaskDoneByPrNumber(42)).toEqual(['t1'])
    })

    it('markTaskCancelledByPrNumber delegates without notification', () => {
      vi.mocked(_markTaskCancelledByPrNumber).mockReturnValue(['t2'])
      expect(markTaskCancelledByPrNumber(99)).toEqual(['t2'])
    })

    it('listTasksWithOpenPrs delegates without notification', () => {
      const tasks: Partial<SprintTask>[] = [{ id: '1' }]
      vi.mocked(_listTasksWithOpenPrs).mockReturnValue(tasks as SprintTask[])
      expect(listTasksWithOpenPrs()).toEqual([{ id: '1' }])
    })

    it('updateTaskMergeableState delegates without notification', () => {
      updateTaskMergeableState(42, 'clean')
      expect(_updateTaskMergeableState).toHaveBeenCalledWith(42, 'clean')
      expect(broadcast).not.toHaveBeenCalled()
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
