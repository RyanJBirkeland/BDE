import { describe, it, expect, vi } from 'vitest'
import {
  createAuthRateLimit,
  computeDelayMs,
  BRUTE_FORCE_THRESHOLD,
  WINDOW_MS,
  INITIAL_DELAY_MS,
  MAX_DELAY_MS
} from './auth-rate-limit'

/**
 * Mutable clock the tests control directly so the delay schedule is
 * deterministic — `Date.now()` would force arbitrary sleeps.
 */
function makeFakeClock(initial = 1_000_000): () => number {
  let now = initial
  const clock = (): number => now
  ;(clock as unknown as { advance: (ms: number) => void }).advance = (ms: number) => {
    now += ms
  }
  return clock
}

function advanceClock(clock: () => number, ms: number): void {
  ;(clock as unknown as { advance: (ms: number) => void }).advance(ms)
}

describe('computeDelayMs', () => {
  it('returns 0 for every failure below the threshold', () => {
    for (let count = 0; count < BRUTE_FORCE_THRESHOLD; count += 1) {
      expect(computeDelayMs(count)).toBe(0)
    }
  })

  it('starts at INITIAL_DELAY_MS on the first failure at the threshold', () => {
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD)).toBe(INITIAL_DELAY_MS)
  })

  it('doubles each step past the threshold', () => {
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD + 1)).toBe(INITIAL_DELAY_MS * 2)
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD + 2)).toBe(INITIAL_DELAY_MS * 4)
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD + 3)).toBe(INITIAL_DELAY_MS * 8)
  })

  it('caps the delay at MAX_DELAY_MS', () => {
    // 200 * 2^5 = 6400 which exceeds the 5000ms cap
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD + 5)).toBe(MAX_DELAY_MS)
    expect(computeDelayMs(BRUTE_FORCE_THRESHOLD + 20)).toBe(MAX_DELAY_MS)
  })
})

describe('createAuthRateLimit', () => {
  it('does not delay the first 9 failures from a single remote', () => {
    const rateLimit = createAuthRateLimit({ now: makeFakeClock() })
    for (let i = 0; i < BRUTE_FORCE_THRESHOLD - 1; i += 1) {
      expect(rateLimit.recordAuthFailure('10.0.0.1')).toBe(0)
    }
  })

  it('applies INITIAL_DELAY_MS on the 10th consecutive failure', () => {
    const rateLimit = createAuthRateLimit({ now: makeFakeClock() })
    for (let i = 0; i < BRUTE_FORCE_THRESHOLD - 1; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.1')
    }
    expect(rateLimit.recordAuthFailure('10.0.0.1')).toBe(INITIAL_DELAY_MS)
  })

  it('progressively increases the delay up to MAX_DELAY_MS on continued failures', () => {
    const rateLimit = createAuthRateLimit({ now: makeFakeClock() })
    for (let i = 0; i < BRUTE_FORCE_THRESHOLD - 1; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.1')
    }

    const delays: number[] = []
    for (let i = 0; i < 10; i += 1) {
      delays.push(rateLimit.recordAuthFailure('10.0.0.1'))
    }

    // Strictly non-decreasing sequence that reaches the cap.
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
    expect(delays[delays.length - 1]).toBe(MAX_DELAY_MS)
  })

  it('logs a brute-force warning exactly once at the threshold', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const rateLimit = createAuthRateLimit({ now: makeFakeClock(), logger })

    for (let i = 0; i < BRUTE_FORCE_THRESHOLD + 3; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.2')
    }

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const warned = logger.warn.mock.calls[0]?.[0] as string
    expect(warned).toContain('mcp.auth.brute-force-suspected')
    expect(warned).toContain('10.0.0.2')
  })

  it('clears the counter for a remote address on a successful auth', () => {
    const rateLimit = createAuthRateLimit({ now: makeFakeClock() })
    for (let i = 0; i < BRUTE_FORCE_THRESHOLD; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.3')
    }

    rateLimit.recordAuthSuccess('10.0.0.3')

    // Fresh counter — next failure must not trigger delay.
    expect(rateLimit.recordAuthFailure('10.0.0.3')).toBe(0)
    expect(rateLimit.size()).toBe(1)
  })

  it('isolates counts between different remote addresses', () => {
    const rateLimit = createAuthRateLimit({ now: makeFakeClock() })
    for (let i = 0; i < BRUTE_FORCE_THRESHOLD - 1; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.4')
    }

    // A different client first-failing sees no penalty.
    expect(rateLimit.recordAuthFailure('10.0.0.5')).toBe(0)
    // The original still crosses the threshold on its next failure.
    expect(rateLimit.recordAuthFailure('10.0.0.4')).toBe(INITIAL_DELAY_MS)
  })

  it('prunes stale entries after WINDOW_MS of inactivity', () => {
    const clock = makeFakeClock()
    const rateLimit = createAuthRateLimit({ now: clock })

    rateLimit.recordAuthFailure('10.0.0.6')
    rateLimit.recordAuthFailure('10.0.0.7')
    expect(rateLimit.size()).toBe(2)

    advanceClock(clock, WINDOW_MS + 1)

    // Any further call triggers pruning of stale entries.
    rateLimit.recordAuthFailure('10.0.0.8')
    expect(rateLimit.size()).toBe(1)
  })

  it('treats a failure after WINDOW_MS as a fresh run (counter reset)', () => {
    const clock = makeFakeClock()
    const rateLimit = createAuthRateLimit({ now: clock })

    for (let i = 0; i < BRUTE_FORCE_THRESHOLD - 1; i += 1) {
      rateLimit.recordAuthFailure('10.0.0.9')
    }

    advanceClock(clock, WINDOW_MS + 1)

    // The client has been quiet for a window — next failure is a fresh #1.
    expect(rateLimit.recordAuthFailure('10.0.0.9')).toBe(0)
  })
})
