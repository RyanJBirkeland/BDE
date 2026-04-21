/**
 * Sprint retry handler unit tests.
 *
 * Verifies that `sprint:retry` clears stale terminal-state fields before
 * transitioning the task to 'queued' so the re-queued row looks fresh
 * (no lingering completed_at, failure_reason, retry_count, etc. from the
 * prior run).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { SprintTask } from '../../../shared/types'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }])
  }
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(() => [])
}))

vi.mock('../../services/sprint-service', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  resetTaskForRetry: vi.fn()
}))

import { registerSprintRetryHandler } from '../sprint-retry-handler'
import { safeHandle } from '../../ipc-utils'
import {
  getTask as _getTask,
  updateTask as _updateTask,
  resetTaskForRetry as _resetTaskForRetry
} from '../../services/sprint-service'

const mockEvent = {} as IpcMainInvokeEvent

function captureRetryHandler(): (e: IpcMainInvokeEvent, taskId: string) => Promise<SprintTask> {
  let captured: ((e: IpcMainInvokeEvent, taskId: string) => Promise<SprintTask>) | undefined
  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === 'sprint:retry') {
      captured = handler as (e: IpcMainInvokeEvent, taskId: string) => Promise<SprintTask>
    }
  })
  registerSprintRetryHandler()
  if (!captured) throw new Error('no handler captured for sprint:retry')
  return captured
}

function failedTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 't-abc123',
    title: 'Demo task',
    repo: 'bde',
    status: 'failed',
    priority: 0,
    completed_at: '2026-04-20T10:00:00.000Z',
    failure_reason: 'pretest failed',
    retry_count: 2,
    fast_fail_count: 1,
    next_eligible_at: '2026-04-20T11:00:00.000Z',
    claimed_by: 'drain-loop',
    started_at: '2026-04-20T09:00:00.000Z',
    ...overrides
  } as SprintTask
}

describe('sprint:retry handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls resetTaskForRetry before setting status to queued', async () => {
    const resetSpy = vi.mocked(_resetTaskForRetry)
    const updateSpy = vi.mocked(_updateTask)
    const callOrder: string[] = []
    resetSpy.mockImplementation(() => {
      callOrder.push('reset')
      return failedTask({ status: 'failed' })
    })
    updateSpy.mockImplementation(() => {
      callOrder.push('update')
      return failedTask({ status: 'queued' })
    })
    vi.mocked(_getTask).mockReturnValue(failedTask())

    const handler = captureRetryHandler()
    await handler(mockEvent, 't-abc123')

    expect(resetSpy).toHaveBeenCalledWith('t-abc123')
    expect(callOrder).toEqual(['reset', 'update'])
    const statusPatch = updateSpy.mock.calls[0][1]
    expect(statusPatch).toMatchObject({ status: 'queued' })
  })

  it('rejects when task is not in a retryable status', async () => {
    vi.mocked(_getTask).mockReturnValue(failedTask({ status: 'active' }))
    const handler = captureRetryHandler()
    await expect(handler(mockEvent, 't-abc123')).rejects.toThrow(/Cannot retry/)
    expect(_resetTaskForRetry).not.toHaveBeenCalled()
  })

  it('rejects when task is not found', async () => {
    vi.mocked(_getTask).mockReturnValue(null)
    const handler = captureRetryHandler()
    await expect(handler(mockEvent, 't-abc123')).rejects.toThrow(/not found/)
    expect(_resetTaskForRetry).not.toHaveBeenCalled()
  })

  it('returns the row from the queued-status update', async () => {
    const queuedRow = failedTask({ status: 'queued', completed_at: null })
    vi.mocked(_getTask).mockReturnValue(failedTask())
    vi.mocked(_resetTaskForRetry).mockReturnValue(failedTask())
    vi.mocked(_updateTask).mockReturnValue(queuedRow)
    const handler = captureRetryHandler()
    const result = await handler(mockEvent, 't-abc123')
    expect(result).toBe(queuedRow)
  })
})
