/**
 * Tests for extracted pure functions from index.ts:
 * - checkOAuthToken: thin boolean adapter over CredentialService (delegation
 *   tested here; success/failure branches covered by credential-service.test.ts)
 * - handleWatchdogVerdict: verdict → task status update + backpressure
 * - taskStatusMap refresh after claim (F-t1-perf-snapshot)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/credential-service', () => ({
  getDefaultCredentialService: vi.fn()
}))

import { checkOAuthToken } from '../oauth-checker'
import { getDefaultCredentialService } from '../../services/credential-service'
import { handleWatchdogVerdict } from '../watchdog-handler'
import { makeConcurrencyState, type ConcurrencyState } from '../concurrency'
import type { WatchdogAction } from '../types'
import type { Logger } from '../types'

function makeLogger(): Logger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function mockCredentialResult(result: {
  status: 'ok' | 'missing' | 'expired' | 'keychain-locked' | 'cli-missing'
  actionable?: string
}): void {
  vi.mocked(getDefaultCredentialService).mockReturnValue({
    getCredential: vi.fn().mockResolvedValue({
      kind: 'claude',
      token: result.status === 'ok' ? 'test-token' : null,
      expiresAt: null,
      cliFound: true,
      ...result
    }),
    refreshCredential: vi.fn(),
    invalidateCache: vi.fn()
  })
}

describe('checkOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when the credential service reports ok', async () => {
    mockCredentialResult({ status: 'ok' })
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns false and surfaces the actionable message on missing credential', async () => {
    mockCredentialResult({ status: 'missing', actionable: 'Run: claude login' })
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Run: claude login'))
  })

  it('returns false on expired credential', async () => {
    mockCredentialResult({ status: 'expired', actionable: 'Run: claude login to refresh' })
    const logger = makeLogger()
    expect(await checkOAuthToken(logger)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('expired'))
  })
})

describe('handleWatchdogVerdict', () => {
  let concurrency: ConcurrencyState

  beforeEach(() => {
    concurrency = makeConcurrencyState(2)
  })

  it('returns error verdict with terminal notification on max-runtime', () => {
    const now = '2026-03-25T12:00:00.000Z'
    const result = handleWatchdogVerdict('max-runtime', concurrency, now, 60 * 60 * 1000)
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
    expect(result.concurrency.capacityAfterBackpressure).toBeLessThan(
      concurrency.capacityAfterBackpressure
    )
  })

  it('reaches floor when backpressure applied at capacityAfterBackpressure=2', () => {
    const result = handleWatchdogVerdict('rate-limit-loop', makeConcurrencyState(2), '')
    expect(result.concurrency.capacityAfterBackpressure).toBe(1)
    expect(result.concurrency.atMinimumCapacity).toBe(true)
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
