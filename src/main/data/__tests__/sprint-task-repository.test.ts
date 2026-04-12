/**
 * Tests for sprint task repository factory wiring.
 * Ensures all interface methods are correctly delegated to sprint-queries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSprintTaskRepository } from '../sprint-task-repository'
import * as queries from '../sprint-queries'

vi.mock('../sprint-queries', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  getActiveTaskCount: vi.fn(),
  claimTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn()
}))

describe('createSprintTaskRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('IAgentTaskRepository methods', () => {
    it('should delegate getTask to queries.getTask', () => {
      const repo = createSprintTaskRepository()
      const mockTask = { id: '1' }
      vi.mocked(queries.getTask).mockReturnValue(mockTask as any)

      const result = repo.getTask('1')

      expect(queries.getTask).toHaveBeenCalledWith('1')
      expect(result).toBe(mockTask)
    })

    it('should delegate updateTask to queries.updateTask', () => {
      const repo = createSprintTaskRepository()
      const mockTask = { id: '1' }
      const patch = { status: 'done' }
      vi.mocked(queries.updateTask).mockReturnValue(mockTask as any)

      const result = repo.updateTask('1', patch)

      expect(queries.updateTask).toHaveBeenCalledWith('1', patch)
      expect(result).toBe(mockTask)
    })

    it('should delegate getQueuedTasks to queries.getQueuedTasks', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1' }]
      vi.mocked(queries.getQueuedTasks).mockReturnValue(mockTasks as any)

      const result = repo.getQueuedTasks(10)

      expect(queries.getQueuedTasks).toHaveBeenCalledWith(10)
      expect(result).toBe(mockTasks)
    })

    it('should delegate getTasksWithDependencies to queries.getTasksWithDependencies', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1', depends_on: null, status: 'queued' }]
      vi.mocked(queries.getTasksWithDependencies).mockReturnValue(mockTasks as any)

      const result = repo.getTasksWithDependencies()

      expect(queries.getTasksWithDependencies).toHaveBeenCalled()
      expect(result).toBe(mockTasks)
    })

    it('should delegate getOrphanedTasks to queries.getOrphanedTasks', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1' }]
      vi.mocked(queries.getOrphanedTasks).mockReturnValue(mockTasks as any)

      const result = repo.getOrphanedTasks('executor-1')

      expect(queries.getOrphanedTasks).toHaveBeenCalledWith('executor-1')
      expect(result).toBe(mockTasks)
    })

    it('should delegate getActiveTaskCount to queries.getActiveTaskCount', () => {
      const repo = createSprintTaskRepository()
      vi.mocked(queries.getActiveTaskCount).mockReturnValue(5)

      const result = repo.getActiveTaskCount()

      expect(queries.getActiveTaskCount).toHaveBeenCalled()
      expect(result).toBe(5)
    })

    it('should delegate claimTask to queries.claimTask', () => {
      const repo = createSprintTaskRepository()
      const mockTask = { id: '1' }
      vi.mocked(queries.claimTask).mockReturnValue(mockTask as any)

      const result = repo.claimTask('1', 'executor-1')

      expect(queries.claimTask).toHaveBeenCalledWith('1', 'executor-1')
      expect(result).toBe(mockTask)
    })
  })

  describe('ISprintPollerRepository methods', () => {
    it('should delegate markTaskDoneByPrNumber to queries.markTaskDoneByPrNumber', () => {
      const repo = createSprintTaskRepository()
      const mockIds = ['1', '2']
      vi.mocked(queries.markTaskDoneByPrNumber).mockReturnValue(mockIds)

      const result = repo.markTaskDoneByPrNumber(123)

      expect(queries.markTaskDoneByPrNumber).toHaveBeenCalledWith(123)
      expect(result).toBe(mockIds)
    })

    it('should delegate markTaskCancelledByPrNumber to queries.markTaskCancelledByPrNumber', () => {
      const repo = createSprintTaskRepository()
      const mockIds = ['1']
      vi.mocked(queries.markTaskCancelledByPrNumber).mockReturnValue(mockIds)

      const result = repo.markTaskCancelledByPrNumber(123)

      expect(queries.markTaskCancelledByPrNumber).toHaveBeenCalledWith(123)
      expect(result).toBe(mockIds)
    })

    it('should delegate listTasksWithOpenPrs to queries.listTasksWithOpenPrs', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1', pr_status: 'open' }]
      vi.mocked(queries.listTasksWithOpenPrs).mockReturnValue(mockTasks as any)

      const result = repo.listTasksWithOpenPrs()

      expect(queries.listTasksWithOpenPrs).toHaveBeenCalled()
      expect(result).toBe(mockTasks)
    })

    it('should delegate updateTaskMergeableState to queries.updateTaskMergeableState', () => {
      const repo = createSprintTaskRepository()
      vi.mocked(queries.updateTaskMergeableState).mockReturnValue(undefined)

      repo.updateTaskMergeableState(123, 'MERGEABLE')

      expect(queries.updateTaskMergeableState).toHaveBeenCalledWith(123, 'MERGEABLE')
    })
  })

  describe('IDashboardRepository methods', () => {
    it('should delegate listTasks to queries.listTasks', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1' }]
      vi.mocked(queries.listTasks).mockReturnValue(mockTasks as any)

      const result = repo.listTasks('queued')

      expect(queries.listTasks).toHaveBeenCalledWith('queued')
      expect(result).toBe(mockTasks)
    })

    it('should delegate listTasksRecent to queries.listTasksRecent', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1' }]
      vi.mocked(queries.listTasksRecent).mockReturnValue(mockTasks as any)

      const result = repo.listTasksRecent()

      expect(queries.listTasksRecent).toHaveBeenCalled()
      expect(result).toBe(mockTasks)
    })

    it('should delegate createTask to queries.createTask', () => {
      const repo = createSprintTaskRepository()
      const mockTask = { id: '1' }
      const input = { title: 'Test', repo: 'bde' }
      vi.mocked(queries.createTask).mockReturnValue(mockTask as any)

      const result = repo.createTask(input as any)

      expect(queries.createTask).toHaveBeenCalledWith(input)
      expect(result).toBe(mockTask)
    })

    it('should delegate deleteTask to queries.deleteTask', () => {
      const repo = createSprintTaskRepository()
      vi.mocked(queries.deleteTask).mockReturnValue(undefined)

      repo.deleteTask('1', 'user-1')

      expect(queries.deleteTask).toHaveBeenCalledWith('1', 'user-1')
    })

    it('should delegate releaseTask to queries.releaseTask', () => {
      const repo = createSprintTaskRepository()
      const mockTask = { id: '1' }
      vi.mocked(queries.releaseTask).mockReturnValue(mockTask as any)

      const result = repo.releaseTask('1', 'executor-1')

      expect(queries.releaseTask).toHaveBeenCalledWith('1', 'executor-1')
      expect(result).toBe(mockTask)
    })

    it('should delegate getQueueStats to queries.getQueueStats', () => {
      const repo = createSprintTaskRepository()
      const mockStats = { total: 10, queued: 3, active: 2, blocked: 1 }
      vi.mocked(queries.getQueueStats).mockReturnValue(mockStats as any)

      const result = repo.getQueueStats()

      expect(queries.getQueueStats).toHaveBeenCalled()
      expect(result).toBe(mockStats)
    })

    it('should delegate getDoneTodayCount to queries.getDoneTodayCount', () => {
      const repo = createSprintTaskRepository()
      vi.mocked(queries.getDoneTodayCount).mockReturnValue(7)

      const result = repo.getDoneTodayCount()

      expect(queries.getDoneTodayCount).toHaveBeenCalled()
      expect(result).toBe(7)
    })

    it('should delegate getHealthCheckTasks to queries.getHealthCheckTasks', () => {
      const repo = createSprintTaskRepository()
      const mockTasks = [{ id: '1' }]
      vi.mocked(queries.getHealthCheckTasks).mockReturnValue(mockTasks as any)

      const result = repo.getHealthCheckTasks()

      expect(queries.getHealthCheckTasks).toHaveBeenCalled()
      expect(result).toBe(mockTasks)
    })

    it('should delegate getSuccessRateBySpecType to queries.getSuccessRateBySpecType', () => {
      const repo = createSprintTaskRepository()
      const mockRates = [{ spec_type: 'feature', success_rate: 0.85 }]
      vi.mocked(queries.getSuccessRateBySpecType).mockReturnValue(mockRates as any)

      const result = repo.getSuccessRateBySpecType()

      expect(queries.getSuccessRateBySpecType).toHaveBeenCalled()
      expect(result).toBe(mockRates)
    })
  })
})
