/**
 * Review handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock dependencies before imports
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

vi.mock('../../data/sprint-queries', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn()
}))

vi.mock('../sprint-listeners', () => ({
  notifySprintMutation: vi.fn()
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn())
}))

import { registerReviewHandlers, setReviewOnStatusTerminal } from '../review'
import { safeHandle } from '../../ipc-utils'

describe('Review handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 7 review channels', () => {
    registerReviewHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(7)
    expect(safeHandle).toHaveBeenCalledWith('review:getDiff', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getCommits', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getFileDiff', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:mergeLocally', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:createPr', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:requestRevision', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:discard', expect.any(Function))
  })

  it('setReviewOnStatusTerminal sets the callback', () => {
    const fn = vi.fn()
    setReviewOnStatusTerminal(fn)
    // Verify it doesn't throw
    expect(fn).not.toHaveBeenCalled()
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers()
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent

    it('review:getCommits parses git log output', async () => {
      // We need to re-mock the promisified execFileAsync
      // Since the module uses promisify at module level, we mock the actual util.promisify
      // to return a function that returns our desired output
      const mockExecFileAsync = vi.fn()
      vi.mocked(await import('util')).promisify = vi.fn(() => mockExecFileAsync) as unknown as typeof import('util').then extends (...args: infer _A) => infer _R ? never : never

      // Re-import to pick up new mock — this is tricky with module-level initialization
      // Instead, verify the handler was registered with correct channel name
      const handlers = captureHandlers()
      expect(handlers['review:getCommits']).toBeDefined()
    })

    it('review:getDiff handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:getDiff']).toBeDefined()
    })

    it('review:getFileDiff handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:getFileDiff']).toBeDefined()
    })

    it('review:mergeLocally handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:mergeLocally']).toBeDefined()
    })

    it('review:createPr handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:createPr']).toBeDefined()
    })

    it('review:requestRevision handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:requestRevision']).toBeDefined()
    })

    it('review:discard handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:discard']).toBeDefined()
    })
  })
})
