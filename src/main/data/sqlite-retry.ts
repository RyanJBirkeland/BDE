/**
 * SQLite retry wrapper with exponential backoff for SQLITE_BUSY errors.
 * Common in WAL mode under concurrent access from multiple processes.
 *
 * Two variants are provided:
 *
 * - `withRetry` (sync) — uses `Atomics.wait` for backoff. Kept for the
 *   many synchronous query helpers that already exist (sprint-queries
 *   et al). DO NOT call from hot paths on the Electron main thread:
 *   under contention this can block the event loop for up to ~5s.
 *
 * - `withRetryAsync` (async) — uses `setTimeout` for backoff so the
 *   event loop keeps spinning. Use this from hot paths like the agent
 *   manager drain loop, watchdog, and task claiming.
 */

interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  logger?: { warn: (msg: string) => void }
}

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const errorWithCode = err as Error & { code?: string }
  return errorWithCode.code === 'SQLITE_BUSY' || err.message.includes('database is locked')
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function computeBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
}

/**
 * Synchronous retry wrapper. Blocks the calling thread on backoff via
 * `Atomics.wait`.
 *
 * **COLD-PATH ONLY.** This function is reserved for migrations and startup
 * reads where an async boundary is not available. It MUST NOT be called from:
 * - The agent-manager drain loop
 * - The watchdog loop
 * - The agent completion pipeline
 * - The Sprint PR poller
 *
 * On any of those paths, use `withRetryAsync` instead. Under WAL contention
 * `Atomics.wait` can block the Electron main-thread event loop for up to ~5 s,
 * freezing IPC, UI repaints, and watchdog ticks for the full backoff duration.
 */
export function withRetry<T>(fn: () => T, opts: RetryOptions = {}): T {
  const { maxRetries = 5, baseDelayMs = 10, maxDelayMs = 1000 } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn()
    } catch (err) {
      lastError = err
      if (!isBusyError(err) || attempt === maxRetries) throw err
      sleepSync(computeBackoff(attempt, baseDelayMs, maxDelayMs))
    }
  }

  throw lastError
}

/**
 * Async retry wrapper. Yields to the event loop on backoff via `setTimeout`,
 * so the Electron main thread stays responsive even under heavy SQLite
 * contention. The wrapped `fn` may itself be sync or async.
 */
export async function withRetryAsync<T>(
  fn: () => T | Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 10, maxDelayMs = 1000 } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isBusyError(err) || attempt === maxRetries) throw err
      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs)
      opts.logger?.warn(
        `[sqlite-retry] SQLITE_BUSY retry attempt=${attempt + 1} backoffMs=${delay}`
      )
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
