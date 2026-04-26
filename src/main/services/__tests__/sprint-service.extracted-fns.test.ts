/**
 * Tests for functions extracted from IPC handlers into sprint-service:
 * buildClaimedTask, forceReleaseClaim, retryTask
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }]) }
}))

// Mock sprint-mutations directly so sprint-service's `mutations.*` calls are controllable
vi.mock('../sprint-mutations', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getDailySuccessRate: vi.fn(),
  flagStuckTasks: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  forceUpdateTask: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}))

vi.mock('../webhook-service', () => ({
  createWebhookService: vi.fn(() => ({ fireWebhook: vi.fn() })),
  getWebhookEventName: vi.fn((type: string) => `sprint.task.${type}`)
}))

vi.mock('../../data/webhook-queries', () => ({ getWebhooks: vi.fn(() => []) }))

vi.mock('../../settings', () => ({ getSettingJson: vi.fn() }))

vi.mock('../../lib/async-utils', () => ({ execFileAsync: vi.fn() }))

// Mock sprint-use-cases so _resetTaskForRetry is controllable without breaking
// other sprint-service.test.ts tests that test resetTaskForRetry's real behaviour
vi.mock('../sprint-use-cases', () => ({
  resetTaskForRetry: vi.fn().mockResolvedValue(null),
  cancelTask: vi.fn(),
  updateTaskFromUi: vi.fn(),
  createTaskWithValidation: vi.fn(),
  TaskTransitionError: class TaskTransitionError extends Error {},
  TaskValidationError: class TaskValidationError extends Error {}
}))

import * as mutations from '../sprint-mutations'
import { getSettingJson } from '../../settings'
import { execFileAsync } from '../../lib/async-utils'
import { resetTaskForRetry as _resetTaskForRetry } from '../sprint-use-cases'
import { setSprintBroadcaster } from '../sprint-mutation-broadcaster'
import { buildClaimedTask, forceReleaseClaim, retryTask } from '../sprint-service'

const mockBroadcastFn = vi.fn()

describe('buildClaimedTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSprintBroadcaster(mockBroadcastFn)
    vi.mocked(getSettingJson).mockReturnValue(null)
  })

  it('returns null when task not found', () => {
    vi.mocked(mutations.getTask).mockReturnValue(null)
    expect(buildClaimedTask('missing')).toBeNull()
  })

  it('returns task with null templatePromptPrefix when task has no template_name', () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', title: 'T', status: 'queued' } as any)
    const result = buildClaimedTask('t1')
    expect(result).toMatchObject({ id: 't1', templatePromptPrefix: null })
  })

  it('returns task with null prefix when templates setting is absent', () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', template_name: 'myTpl' } as any)
    vi.mocked(getSettingJson).mockReturnValue(null)
    const result = buildClaimedTask('t1')
    expect(result?.templatePromptPrefix).toBeNull()
  })

  it('returns matched template promptPrefix when template_name matches', () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', template_name: 'bug-fix' } as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'bug-fix', promptPrefix: 'Fix the following bug:', specTemplate: '' }
    ] as any)
    const result = buildClaimedTask('t1')
    expect(result?.templatePromptPrefix).toBe('Fix the following bug:')
  })

  it('returns null prefix when template_name does not match any template', () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', template_name: 'unknown' } as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'other', promptPrefix: 'Something else', specTemplate: '' }
    ] as any)
    const result = buildClaimedTask('t1')
    expect(result?.templatePromptPrefix).toBeNull()
  })
})

describe('forceReleaseClaim', () => {
  const mockTaskStateService = { transition: vi.fn().mockResolvedValue(undefined) }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setSprintBroadcaster(mockBroadcastFn)
    mockTaskStateService.transition.mockReset().mockResolvedValue(undefined)
    vi.mocked(_resetTaskForRetry).mockResolvedValue(null as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws when task not found', async () => {
    vi.mocked(mutations.getTask).mockReturnValue(null)
    await expect(
      forceReleaseClaim('missing', { taskStateService: mockTaskStateService as any })
    ).rejects.toThrow('Task missing not found')
  })

  it('throws when task is not active', async () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', status: 'queued' } as any)
    await expect(
      forceReleaseClaim('t1', { taskStateService: mockTaskStateService as any })
    ).rejects.toThrow('Cannot force-release')
  })

  it('re-queues an active task and fires broadcast', async () => {
    const activeTask = { id: 't1', status: 'active' }
    const releasedTask = { id: 't1', status: 'queued' }
    vi.mocked(mutations.getTask)
      .mockReturnValueOnce(activeTask as any)
      .mockReturnValueOnce(releasedTask as any)

    const result = await forceReleaseClaim('t1', {
      taskStateService: mockTaskStateService as any
    })
    vi.runAllTimers()

    expect(_resetTaskForRetry).toHaveBeenCalledWith('t1')
    expect(mockTaskStateService.transition).toHaveBeenCalledWith(
      't1',
      'queued',
      expect.objectContaining({ caller: 'sprint:forceReleaseClaim' })
    )
    expect(mockBroadcastFn).toHaveBeenCalled()
    expect(result).toEqual(releasedTask)
  })

  it('calls cancelAgent when provided', async () => {
    const cancelAgent = vi.fn().mockResolvedValue(undefined)
    const activeTask = { id: 't1', status: 'active' }
    const releasedTask = { id: 't1', status: 'queued' }
    vi.mocked(mutations.getTask)
      .mockReturnValueOnce(activeTask as any)
      .mockReturnValueOnce(releasedTask as any)

    await forceReleaseClaim('t1', {
      cancelAgent,
      taskStateService: mockTaskStateService as any
    })

    expect(cancelAgent).toHaveBeenCalledWith('t1')
  })

  it('succeeds without cancelAgent', async () => {
    const activeTask = { id: 't1', status: 'active' }
    const releasedTask = { id: 't1', status: 'queued' }
    vi.mocked(mutations.getTask)
      .mockReturnValueOnce(activeTask as any)
      .mockReturnValueOnce(releasedTask as any)

    await expect(
      forceReleaseClaim('t1', { taskStateService: mockTaskStateService as any })
    ).resolves.toEqual(releasedTask)
  })
})

describe('retryTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setSprintBroadcaster(mockBroadcastFn)
    vi.mocked(_resetTaskForRetry).mockResolvedValue(null as any)
    vi.mocked(getSettingJson).mockReturnValue(null)
    vi.mocked(execFileAsync as any).mockResolvedValue({ stdout: '', stderr: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws when task not found', async () => {
    vi.mocked(mutations.getTask).mockReturnValue(null)
    await expect(retryTask('missing')).rejects.toThrow('Task missing not found')
  })

  it('throws when task is not in a terminal status', async () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', status: 'active' } as any)
    await expect(retryTask('t1')).rejects.toThrow('Cannot retry task with status active')
  })

  it('re-queues a failed task', async () => {
    const failedTask = { id: 't1', status: 'failed', title: 'My task', repo: 'bde' }
    const queuedTask = { id: 't1', status: 'queued' }
    vi.mocked(mutations.getTask).mockReturnValue(failedTask as any)
    vi.mocked(mutations.updateTask).mockResolvedValue(queuedTask as any)

    const result = await retryTask('t1')
    vi.runAllTimers()

    expect(_resetTaskForRetry).toHaveBeenCalledWith('t1')
    expect(mutations.updateTask).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'queued', notes: null, agent_run_id: null })
    )
    expect(mockBroadcastFn).toHaveBeenCalled()
    expect(result).toEqual(queuedTask)
  })

  it('re-queues error and cancelled tasks', async () => {
    for (const status of ['error', 'cancelled'] as const) {
      vi.clearAllMocks()
      setSprintBroadcaster(mockBroadcastFn)
      vi.mocked(_resetTaskForRetry).mockResolvedValue(null as any)
      vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', status, title: 'T', repo: 'bde' } as any)
      vi.mocked(mutations.updateTask).mockResolvedValue({ id: 't1', status: 'queued' } as any)

      await expect(retryTask('t1')).resolves.toMatchObject({ status: 'queued' })
    }
  })

  it('skips git cleanup when repo path is not configured', async () => {
    vi.mocked(mutations.getTask).mockReturnValue({ id: 't1', status: 'failed', title: 'T', repo: 'bde' } as any)
    vi.mocked(getSettingJson).mockReturnValue(null)
    vi.mocked(mutations.updateTask).mockResolvedValue({ id: 't1', status: 'queued' } as any)

    await retryTask('t1')

    expect(execFileAsync).not.toHaveBeenCalled()
  })

  it('git cleanup failure does not block retry', async () => {
    vi.mocked(mutations.getTask).mockReturnValue({
      id: 't1', status: 'failed', title: 'My task', repo: 'bde'
    } as any)
    vi.mocked(getSettingJson).mockReturnValue([{ name: 'bde', localPath: '/repo/bde' }])
    vi.mocked(execFileAsync as any).mockRejectedValue(new Error('git worktree prune failed'))
    vi.mocked(mutations.updateTask).mockResolvedValue({ id: 't1', status: 'queued' } as any)

    const result = await retryTask('t1')
    expect(result).toMatchObject({ status: 'queued' })
  })
})
