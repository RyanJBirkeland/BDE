import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import {
  attachRendererLoadRetry,
  MAX_RENDERER_LOAD_RETRIES,
  RENDERER_RETRY_BASE_DELAY_MS,
  ERR_ABORTED
} from '../renderer-load-retry'

// Shared mock logger — returned for every createLogger() call so the source's
// module-scope logger and the test's logger reference are the same instance.
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
}))

vi.mock('../logger', () => ({
  createLogger: () => mockLogger
}))

type DidFailLoadCallback = (
  event: unknown,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean
) => void

describe('attachRendererLoadRetry', () => {
  let mockWindow: BrowserWindow
  let didFailLoadCallback: DidFailLoadCallback | null = null
  let loadURLSpy: ReturnType<typeof vi.fn>
  let isDestroyedValue = false

  beforeEach(() => {
    vi.useFakeTimers()
    didFailLoadCallback = null
    isDestroyedValue = false
    loadURLSpy = vi.fn().mockResolvedValue(undefined)

    const mockWebContents = {
      on: vi.fn((event: string, callback: DidFailLoadCallback) => {
        if (event === 'did-fail-load') {
          didFailLoadCallback = callback
        }
      })
    } as unknown as WebContents

    mockWindow = {
      webContents: mockWebContents,
      loadURL: loadURLSpy,
      isDestroyed: () => isDestroyedValue
    } as unknown as BrowserWindow

    attachRendererLoadRetry(mockWindow)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('ignores non-main-frame events', () => {
    didFailLoadCallback!(
      {},
      -1,
      'Generic error',
      'http://localhost:5173',
      false // isMainFrame = false
    )

    vi.runAllTimers()

    expect(loadURLSpy).not.toHaveBeenCalled()
  })

  it('ignores ERR_ABORTED (-3)', () => {
    didFailLoadCallback!({}, ERR_ABORTED, 'ERR_ABORTED', 'http://localhost:5173', true)

    vi.runAllTimers()

    expect(loadURLSpy).not.toHaveBeenCalled()
  })

  it('schedules loadURL after base delay on first failure', () => {
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    expect(loadURLSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)

    expect(loadURLSpy).toHaveBeenCalledTimes(1)
    expect(loadURLSpy).toHaveBeenCalledWith('http://localhost:5173')
  })

  it('scales backoff delay with attempt number', () => {
    // First failure: 500ms delay
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)
    expect(loadURLSpy).toHaveBeenCalledTimes(1)

    // Second failure: 1000ms delay (500 * 2)
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)
    expect(loadURLSpy).toHaveBeenCalledTimes(1) // Still 1, not enough time

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)
    expect(loadURLSpy).toHaveBeenCalledTimes(2) // Now 2

    // Third failure: 1500ms delay (500 * 3)
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS * 2)
    expect(loadURLSpy).toHaveBeenCalledTimes(2) // Still 2

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)
    expect(loadURLSpy).toHaveBeenCalledTimes(3) // Now 3
  })

  it('logs budget exhaustion after max retries and stops scheduling', () => {
    const logger = mockLogger

    // Trigger MAX_RENDERER_LOAD_RETRIES failures (3)
    for (let i = 0; i < MAX_RENDERER_LOAD_RETRIES; i++) {
      didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)
    }

    vi.runAllTimers()
    expect(loadURLSpy).toHaveBeenCalledTimes(MAX_RENDERER_LOAD_RETRIES)

    // Fourth failure should log budget exhaustion
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    vi.runAllTimers()

    expect(loadURLSpy).toHaveBeenCalledTimes(MAX_RENDERER_LOAD_RETRIES) // Still 3, no new retry
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retry budget exhausted'))
  })

  it('short-circuits when window is destroyed before retry fires', () => {
    didFailLoadCallback!({}, -2, 'ERR_FAILED', 'http://localhost:5173', true)

    // Mark window as destroyed before timer fires
    isDestroyedValue = true

    vi.advanceTimersByTime(RENDERER_RETRY_BASE_DELAY_MS)

    expect(loadURLSpy).not.toHaveBeenCalled()
  })
})
