/**
 * Progressive delay / rate limit for consecutive auth failures on the
 * MCP server.
 *
 * The bearer token is 256-bit random so brute force is infeasible, but
 * a misconfigured client in a tight loop (or a probing attacker) can
 * still produce an arbitrary number of 401s per second — polluting the
 * log and costing CPU on every rejection. This module applies
 * per-remote-address bookkeeping so callers can:
 *
 *   1) detect a suspected brute-force run (threshold reached), and
 *   2) inject a progressive delay before writing the 401, capped at
 *      `MAX_DELAY_MS` so a single client can't stall the server.
 *
 * Wire it up by calling `recordAuthFailure(remoteAddress)` on every 401
 * (use the returned `delayMs` to `await` before responding) and
 * `recordAuthSuccess(remoteAddress)` on every 200. A 60s inactivity
 * window reclaims memory without the caller doing anything.
 */
import type { Logger } from '../logger'

/** Number of consecutive failures before progressive delay kicks in. */
export const BRUTE_FORCE_THRESHOLD = 10

/** Counter window — failures outside this window are treated as a fresh run. */
export const WINDOW_MS = 60_000

/** Delay used on the first failure at or past the threshold. */
export const INITIAL_DELAY_MS = 200

/** Upper bound on the progressive delay. Keeps a single client from stalling the server. */
export const MAX_DELAY_MS = 5_000

interface FailureRecord {
  count: number
  firstFailedAt: number
  lastFailedAt: number
}

export interface AuthRateLimitOptions {
  /** Used for the "brute force suspected" warn line. */
  logger?: Logger
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

export interface AuthRateLimit {
  /**
   * Record a failed auth attempt for a remote address. Returns the
   * delay (milliseconds) the caller should apply before writing the
   * 401 response. `0` means no throttling — the attempt is within
   * the tolerance threshold.
   */
  recordAuthFailure: (remoteAddress: string) => number
  /**
   * Record a successful auth attempt. Clears the counter for this
   * remote address so a recovering client isn't permanently penalized.
   */
  recordAuthSuccess: (remoteAddress: string) => void
  /** Test/introspection hook — number of tracked remote addresses. */
  size: () => number
}

export function createAuthRateLimit(options: AuthRateLimitOptions = {}): AuthRateLimit {
  const failures = new Map<string, FailureRecord>()
  const clock = options.now ?? Date.now
  const logger = options.logger

  return {
    recordAuthFailure(remoteAddress: string): number {
      pruneStaleEntries(failures, clock())
      const record = incrementFailure(failures, remoteAddress, clock())
      if (record.count === BRUTE_FORCE_THRESHOLD) {
        logger?.warn(
          JSON.stringify({
            event: 'mcp.auth.brute-force-suspected',
            remoteAddress,
            count: record.count
          })
        )
      }
      return computeDelayMs(record.count)
    },

    recordAuthSuccess(remoteAddress: string): void {
      failures.delete(remoteAddress)
    },

    size(): number {
      return failures.size
    }
  }
}

/**
 * Bump the counter for this address. A failure outside the rolling
 * window resets the record — the attacker/client has been quiet for a
 * minute, don't permanently penalize them.
 */
function incrementFailure(
  failures: Map<string, FailureRecord>,
  remoteAddress: string,
  now: number
): FailureRecord {
  const existing = failures.get(remoteAddress)
  if (!existing || now - existing.lastFailedAt > WINDOW_MS) {
    const fresh: FailureRecord = { count: 1, firstFailedAt: now, lastFailedAt: now }
    failures.set(remoteAddress, fresh)
    return fresh
  }
  existing.count += 1
  existing.lastFailedAt = now
  return existing
}

/**
 * Walk the tracked records and drop any whose last failure is older
 * than `WINDOW_MS`. Called on every failure so the Map stays bounded
 * without a separate timer.
 */
function pruneStaleEntries(failures: Map<string, FailureRecord>, now: number): void {
  for (const [address, record] of failures) {
    if (now - record.lastFailedAt > WINDOW_MS) {
      failures.delete(address)
    }
  }
}

/**
 * Progressive back-off. Below the threshold, no throttling. At/above,
 * delay doubles for every additional failure, capped at `MAX_DELAY_MS`:
 *
 *   failure #10 → 200ms
 *   failure #11 → 400ms
 *   failure #12 → 800ms
 *   failure #13 → 1600ms
 *   failure #14 → 3200ms
 *   failure #15 → 5000ms (capped)
 */
export function computeDelayMs(failureCount: number): number {
  if (failureCount < BRUTE_FORCE_THRESHOLD) return 0
  const stepsPastThreshold = failureCount - BRUTE_FORCE_THRESHOLD
  const delay = INITIAL_DELAY_MS * 2 ** stepsPastThreshold
  return Math.min(delay, MAX_DELAY_MS)
}
