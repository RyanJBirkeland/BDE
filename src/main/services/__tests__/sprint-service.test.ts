/**
 * Sprint service layer unit tests.
 * Verifies that service wrappers delegate to sprint-queries
 * and fire mutation notifications on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock sprint-queries (data layer)
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title', 'status', 'prompt', 'spec', 'notes']),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn()
}))

// Mock sprint-listeners (SSE broadcaster)
vi.mock('../../handlers/sprint-listeners', () => ({
  notifySprintMutation: vi.fn()
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
  getHealthCheckTasks
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
  getDoneTodayCount as _getDoneTodayCount,
  markTaskDoneByPrNumber as _markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber as _markTaskCancelledByPrNumber,
  listTasksWithOpenPrs as _listTasksWithOpenPrs,
  updateTaskMergeableState as _updateTaskMergeableState,
  getHealthCheckTasks as _getHealthCheckTasks
} from '../../data/sprint-queries'

import { notifySprintMutation } from '../../handlers/sprint-listeners'

describe('sprint-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTask', () => {
    it('delegates to sprint-queries', () => {
      const task = { id: '1', title: 'Test' }
      vi.mocked(_getTask).mockReturnValue(task as any)
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
      const tasks = [{ id: '1' }, { id: '2' }]
      vi.mocked(_listTasks).mockReturnValue(tasks as any)
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
      const input = { title: 'New', repo: 'bde' }
      const created = { id: 'abc', ...input }
      vi.mocked(_createTask).mockReturnValue(created as any)

      const result = createTask(input as any)
      expect(result).toEqual(created)
      expect(_createTask).toHaveBeenCalledWith(input)
      expect(notifySprintMutation).toHaveBeenCalledWith('created', created)
    })

    it('does not notify when createTask returns null', () => {
      vi.mocked(_createTask).mockReturnValue(null)
      const result = createTask({ title: 'Bad', repo: 'bde' } as any)
      expect(result).toBeNull()
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })
  })

  describe('updateTask', () => {
    it('updates task and fires updated notification', () => {
      const updated = { id: '1', title: 'Updated' }
      vi.mocked(_updateTask).mockReturnValue(updated as any)

      const result = updateTask('1', { title: 'Updated' })
      expect(result).toEqual(updated)
      expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' })
      expect(notifySprintMutation).toHaveBeenCalledWith('updated', updated)
    })

    it('does not notify when updateTask returns null', () => {
      vi.mocked(_updateTask).mockReturnValue(null)
      const result = updateTask('missing', { title: 'X' })
      expect(result).toBeNull()
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('deletes task and fires deleted notification', () => {
      const task = { id: '1', title: 'Doomed' }
      vi.mocked(_getTask).mockReturnValue(task as any)

      deleteTask('1')
      expect(_deleteTask).toHaveBeenCalledWith('1')
      expect(notifySprintMutation).toHaveBeenCalledWith('deleted', task)
    })

    it('does not notify when task not found before delete', () => {
      vi.mocked(_getTask).mockReturnValue(null)
      deleteTask('missing')
      expect(_deleteTask).toHaveBeenCalledWith('missing')
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })
  })

  describe('claimTask', () => {
    it('claims task and fires updated notification', () => {
      const claimed = { id: '1', claimed_by: 'agent-1' }
      vi.mocked(_claimTask).mockReturnValue(claimed as any)

      const result = claimTask('1', 'agent-1')
      expect(result).toEqual(claimed)
      expect(_claimTask).toHaveBeenCalledWith('1', 'agent-1')
      expect(notifySprintMutation).toHaveBeenCalledWith('updated', claimed)
    })

    it('does not notify when claim fails', () => {
      vi.mocked(_claimTask).mockReturnValue(null)
      const result = claimTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })
  })

  describe('releaseTask', () => {
    it('releases task and fires updated notification', () => {
      const released = { id: '1', claimed_by: null }
      vi.mocked(_releaseTask).mockReturnValue(released as any)

      const result = releaseTask('1', 'agent-1')
      expect(result).toEqual(released)
      expect(_releaseTask).toHaveBeenCalledWith('1', 'agent-1')
      expect(notifySprintMutation).toHaveBeenCalledWith('updated', released)
    })

    it('does not notify when release fails', () => {
      vi.mocked(_releaseTask).mockReturnValue(null)
      const result = releaseTask('1', 'agent-1')
      expect(result).toBeNull()
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })
  })

  describe('passthrough functions', () => {
    it('getQueueStats delegates without notification', () => {
      const stats = { queued: 5, active: 2 }
      vi.mocked(_getQueueStats).mockReturnValue(stats as any)
      expect(getQueueStats()).toEqual(stats)
      expect(notifySprintMutation).not.toHaveBeenCalled()
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
      vi.mocked(_listTasksWithOpenPrs).mockReturnValue([{ id: '1' }] as any)
      expect(listTasksWithOpenPrs()).toEqual([{ id: '1' }])
    })

    it('updateTaskMergeableState delegates without notification', () => {
      updateTaskMergeableState(42, 'clean')
      expect(_updateTaskMergeableState).toHaveBeenCalledWith(42, 'clean')
      expect(notifySprintMutation).not.toHaveBeenCalled()
    })

    it('getHealthCheckTasks delegates without notification', () => {
      vi.mocked(_getHealthCheckTasks).mockReturnValue([{ id: '1' }] as any)
      expect(getHealthCheckTasks()).toEqual([{ id: '1' }])
    })
  })
})
