/**
 * Tests for extracted pure functions from index.ts:
 * - checkOAuthToken: OAuth token file validation
 * - handleWatchdogVerdict: verdict → task status update + backpressure
 * - taskStatusMap refresh after claim (F-t1-perf-snapshot)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readFile: vi.fn(), stat: vi.fn() }
})

vi.mock('../../env-utils', () => ({
  refreshOAuthTokenFromKeychain: vi.fn(),
  invalidateOAuthToken: vi.fn()
}))

import { readFile, stat } from 'node:fs/promises'
import {
  checkOAuthToken,
  invalidateCheckOAuthTokenCache,
  OAUTH_CHECK_CACHE_TTL_MS,
  OAUTH_CHECK_FAIL_CACHE_TTL_MS
} from '../oauth-checker'
import { handleWatchdogVerdict } from '../watchdog-handler'
import { makeConcurrencyState, type ConcurrencyState } from '../concurrency'
import type { WatchdogAction } from '../types'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../../env-utils'
import type { Logger } from '../types'

const readFileMock = vi.mocked(readFile)
const statMock = vi.mocked(stat)

function makeLogger(): Logger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('checkOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateCheckOAuthTokenCache()
    // Default: token file is recent (1 minute old) — no age-based refresh
    statMock.mockResolvedValue({ mtimeMs: Date.now() - 60_000 } as Awaited<ReturnType<typeof stat>>)
  })

  it('returns true when token file has valid content (>= 20 chars)', async () => {
    readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns false and logs warning when token file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot read OAuth token file')
    )
  })

  it('attempts keychain refresh when token is too short and succeeds', async () => {
    readFileMock.mockResolvedValue('short')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OAuth token auto-refreshed'))
  })

  it('returns false when token is too short and keychain refresh fails', async () => {
    readFileMock.mockResolvedValue('short')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('keychain refresh failed'))
  })

  it('returns false when token file is empty', async () => {
    readFileMock.mockResolvedValue('')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    expect(await checkOAuthToken(makeLogger())).toBe(false)
  })

  it('trims whitespace from token before checking length', async () => {
    readFileMock.mockResolvedValue('                    ')
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
    expect(await checkOAuthToken(makeLogger())).toBe(false)
  })

  it('proactively refreshes when token file is older than 45 minutes', async () => {
    readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')
    statMock.mockResolvedValue({ mtimeMs: Date.now() - 46 * 60_000 } as Awaited<
      ReturnType<typeof stat>
    >)
    vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('proactively refreshed'))
  })

  it('does not proactively refresh when token file is recent (< 45 minutes)', async () => {
    readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')
    statMock.mockResolvedValue({ mtimeMs: Date.now() - 10 * 60_000 } as Awaited<
      ReturnType<typeof stat>
    >)
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(refreshOAuthTokenFromKeychain).not.toHaveBeenCalled()
  })

  it('continues with existing token when stat fails during age check', async () => {
    readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')
    statMock.mockRejectedValue(new Error('stat failed'))
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reads token file only once when called N times within TTL (F-t1-sysprof-5)', async () => {
    readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')

    for (let i = 0; i < 10; i++) {
      expect(await checkOAuthToken(makeLogger())).toBe(true)
    }

    // Only the first call should have hit the filesystem
    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks after success TTL expires (F-t1-sysprof-5)', async () => {
    vi.useFakeTimers()
    try {
      readFileMock.mockResolvedValue('a-valid-oauth-token-that-is-long-enough')
      await checkOAuthToken(makeLogger())
      expect(readFileMock).toHaveBeenCalledTimes(1)

      // Advance past the success TTL
      vi.advanceTimersByTime(OAUTH_CHECK_CACHE_TTL_MS + 1)

      await checkOAuthToken(makeLogger())
      expect(readFileMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-checks after failure TTL expires (F-t1-sysprof-5)', async () => {
    vi.useFakeTimers()
    try {
      readFileMock.mockRejectedValue(new Error('ENOENT'))
      await checkOAuthToken(makeLogger())
      expect(readFileMock).toHaveBeenCalledTimes(1)

      // Advance past the failure TTL (shorter: 30s)
      vi.advanceTimersByTime(OAUTH_CHECK_FAIL_CACHE_TTL_MS + 1)

      await checkOAuthToken(makeLogger())
      expect(readFileMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handleWatchdogVerdict', () => {
  let concurrency: ConcurrencyState

  beforeEach(() => {
    concurrency = makeConcurrencyState(2)
  })

  it('returns error verdict with terminal notification on max-runtime', () => {
    const now = '2026-03-25T12:00:00.000Z'
    const result = handleWatchdogVerdict(
      'max-runtime',
      concurrency,
      now,
      60 * 60 * 1000
    )
    expect(result.taskUpdate).toEqual({
      status: 'error',
      completed_at: now,
      claimed_by: null,
      notes:
        'Agent exceeded the maximum runtime of 60 minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.',
      needs_review: true
    })
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
  })

  it('returns error verdict with terminal notification on idle', () => {
    const now = '2026-03-25T12:00:00.000Z'
    const result = handleWatchdogVerdict('idle', concurrency, now)
    expect(result.taskUpdate).toEqual({
      status: 'error',
      completed_at: now,
      claimed_by: null,
      notes:
        "Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to 'queued'.",
      needs_review: true
    })
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
  })

  it('returns requeue verdict with backpressure on rate-limit-loop', () => {
    const result = handleWatchdogVerdict('rate-limit-loop', concurrency, '')
    expect(result.taskUpdate).toEqual({
      status: 'queued',
      claimed_by: null,
      notes:
        'Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown.'
    })
    expect(result.shouldNotifyTerminal).toBe(false)
    expect(result.concurrency.effectiveSlots).toBeLessThan(concurrency.effectiveSlots)
  })

  it('reaches floor when backpressure applied at effectiveSlots=2', () => {
    const result = handleWatchdogVerdict(
      'rate-limit-loop',
      makeConcurrencyState(2),
      ''
    )
    expect(result.concurrency.effectiveSlots).toBe(1)
    expect(result.concurrency.atFloor).toBe(true)
  })

  it('returns error verdict with terminal notification on cost-budget-exceeded', () => {
    const now = '2026-03-25T12:00:00.000Z'
    const result = handleWatchdogVerdict('cost-budget-exceeded', concurrency, now)
    expect(result.taskUpdate).toEqual({
      status: 'error',
      completed_at: now,
      claimed_by: null,
      notes:
        'Agent exceeded the cost budget (max_cost_usd). The task consumed more API credits than allowed. Review the task complexity or increase the budget.',
      needs_review: true
    })
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
  })

  it('returns no-op for unknown verdict', () => {
    const result = handleWatchdogVerdict('unknown' as WatchdogAction, concurrency, '')
    expect(result.taskUpdate).toBeNull()
    expect(result.shouldNotifyTerminal).toBe(false)
  })
})
