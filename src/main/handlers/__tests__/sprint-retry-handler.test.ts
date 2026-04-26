/**
 * Sprint retry handler unit tests.
 *
 * The handler is a thin wrapper — it validates the task ID then delegates to
 * retryTask() in sprint-service. Business logic is covered by
 * sprint-service.extracted-fns.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { SprintTask } from '../../../shared/types'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }))
}))

vi.mock('../../services/sprint-service', () => ({
  retryTask: vi.fn()
}))

import { registerSprintRetryHandler } from '../sprint-retry-handler'
import { safeHandle } from '../../ipc-utils'
import { retryTask as _retryTask } from '../../services/sprint-service'

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

describe('sprint:retry handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to retryTask with the task ID', async () => {
    const queuedRow = { id: 't-abc123', status: 'queued' } as SprintTask
    vi.mocked(_retryTask).mockResolvedValue(queuedRow)

    const handler = captureRetryHandler()
    const result = await handler(mockEvent, 't-abc123')

    expect(_retryTask).toHaveBeenCalledWith('t-abc123')
    expect(result).toBe(queuedRow)
  })

  it('rejects invalid task ID before calling retryTask', async () => {
    const handler = captureRetryHandler()
    await expect(handler(mockEvent, '../../etc/passwd')).rejects.toThrow('Invalid task ID format')
    expect(_retryTask).not.toHaveBeenCalled()
  })

  it('rejects empty task ID', async () => {
    const handler = captureRetryHandler()
    await expect(handler(mockEvent, '')).rejects.toThrow('Invalid task ID format')
    expect(_retryTask).not.toHaveBeenCalled()
  })
})
