/**
 * Tests for extracted pure functions from index.ts:
 * - checkOAuthToken: OAuth token file validation
 * - handleWatchdogVerdict: verdict → task status update + backpressure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readFileSync: vi.fn(), statSync: vi.fn() }
})

vi.mock('../../env-utils', () => ({
  refreshOAuthTokenFromKeychain: vi.fn(),
  invalidateOAuthToken: vi.fn(),
}))

import { readFileSync, statSync } from 'node:fs'
import { checkOAuthToken, handleWatchdogVerdict } from '../index'
import { makeConcurrencyState, type ConcurrencyState } from '../concurrency'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../../env-utils'
import type { Logger } from '../types'

const readFileMock = vi.mocked(readFileSync)
const statSyncMock = vi.mocked(statSync)

function makeLogger(): Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('checkOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: token file is recent (1 minute old) — no age-based refresh
    statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 60_000 } as ReturnType<typeof statSync>)
  })

  it('returns true when token file has valid content (>= 20 chars)', async () => {
    readFileMock.mockReturnValue('a-valid-oauth-token-that-is-long-enough')
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns false and logs warning when token file cannot be read', async () => {
    readFileMock.mockImplementation(() => { throw new Error('ENOENT') })
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cannot read OAuth token file'))
  })

  it('attempts keychain refresh when token is too short and succeeds', async () => {
    readFileMock.mockReturnValue('short')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OAuth token auto-refreshed'))
  })

  it('returns false when token is too short and keychain refresh fails', async () => {
    readFileMock.mockReturnValue('short')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('keychain refresh failed'))
  })

  it('returns false when token file is empty', async () => {
    readFileMock.mockReturnValue('')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    expect(await checkOAuthToken(makeLogger())).toBe(false)
  })

  it('trims whitespace from token before checking length', async () => {
    readFileMock.mockReturnValue('                    ')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    expect(await checkOAuthToken(makeLogger())).toBe(false)
  })

  it('proactively refreshes when token file is older than 45 minutes', async () => {
    readFileMock.mockReturnValue('a-valid-oauth-token-that-is-long-enough')
    statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 46 * 60_000 } as ReturnType<typeof statSync>)
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('proactively refreshed'))
  })

  it('does not proactively refresh when token file is recent (< 45 minutes)', async () => {
    readFileMock.mockReturnValue('a-valid-oauth-token-that-is-long-enough')
    statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 10 * 60_000 } as ReturnType<typeof statSync>)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).not.toHaveBeenCalled()
  })

  it('continues with existing token when stat fails during age check', async () => {
    readFileMock.mockReturnValue('a-valid-oauth-token-that-is-long-enough')
    statSyncMock.mockImplementation(() => { throw new Error('stat failed') })
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('handleWatchdogVerdict', () => {
  let logger: ReturnType<typeof makeLogger>
  let mockUpdateTask: ReturnType<typeof vi.fn>
  let mockOnTerminal: ReturnType<typeof vi.fn>
  let concurrency: ConcurrencyState

  beforeEach(() => {
    logger = makeLogger()
    mockUpdateTask = vi.fn().mockResolvedValue(null)
    mockOnTerminal = vi.fn().mockResolvedValue(undefined)
    concurrency = makeConcurrencyState(2)
  })

  it('marks task as error with "Max runtime exceeded" on max-runtime', async () => {
    const now = '2026-03-25T12:00:00.000Z'
    handleWatchdogVerdict('max-runtime', 'task-1', concurrency, now, mockUpdateTask, mockOnTerminal, logger)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { status: 'error', completed_at: now, notes: 'Max runtime exceeded', needs_review: true })
    await vi.waitFor(() => { expect(mockOnTerminal).toHaveBeenCalledWith('task-1', 'error') })
  })

  it('marks task as error with "Idle timeout" on idle', async () => {
    const now = '2026-03-25T12:00:00.000Z'
    handleWatchdogVerdict('idle', 'task-2', concurrency, now, mockUpdateTask, mockOnTerminal, logger)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-2', { status: 'error', completed_at: now, notes: 'Idle timeout', needs_review: true })
    await vi.waitFor(() => { expect(mockOnTerminal).toHaveBeenCalledWith('task-2', 'error') })
  })

  it('re-queues task and applies backpressure on rate-limit-loop', () => {
    const result = handleWatchdogVerdict('rate-limit-loop', 'task-3', concurrency, '', mockUpdateTask, mockOnTerminal, logger)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-3', { status: 'queued', claimed_by: null, notes: 'Rate-limit loop — re-queued' })
    expect(result.effectiveSlots).toBeLessThan(concurrency.effectiveSlots)
    expect(mockOnTerminal).not.toHaveBeenCalled()
  })

  it('reaches floor when backpressure applied at effectiveSlots=2', () => {
    const result = handleWatchdogVerdict('rate-limit-loop', 'task-4', makeConcurrencyState(2), '', mockUpdateTask, mockOnTerminal, logger)
    expect(result.effectiveSlots).toBe(1)
    expect(result.atFloor).toBe(true)
  })

  it('logs warning when updateTask rejects for max-runtime', async () => {
    mockUpdateTask.mockRejectedValue(new Error('DB error'))
    handleWatchdogVerdict('max-runtime', 'task-5', concurrency, '', mockUpdateTask, mockOnTerminal, logger)
    await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-5 after max-runtime kill')) })
  })

  it('logs warning when updateTask rejects for idle', async () => {
    mockUpdateTask.mockRejectedValue(new Error('DB error'))
    handleWatchdogVerdict('idle', 'task-6', concurrency, '', mockUpdateTask, mockOnTerminal, logger)
    await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-6 after idle kill')) })
  })

  it('logs warning when updateTask rejects for rate-limit-loop', async () => {
    mockUpdateTask.mockRejectedValue(new Error('DB error'))
    handleWatchdogVerdict('rate-limit-loop', 'task-7', concurrency, '', mockUpdateTask, mockOnTerminal, logger)
    await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to requeue rate-limited task task-7')) })
  })
})
