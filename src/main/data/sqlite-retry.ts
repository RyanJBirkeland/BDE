/**
 * SQLite retry wrapper with exponential backoff for SQLITE_BUSY errors.
 * Common in WAL mode under concurrent access from multiple processes.
 */

interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const errorWithCode = err as Error & { code?: string }
  return errorWithCode.code === 'SQLITE_BUSY' || err.message.includes('database is locked')
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Wraps a synchronous function with automatic retry + exponential backoff
 * when SQLITE_BUSY is encountered.
 *
 * @param fn - The function to execute
 * @param opts - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted or a non-BUSY error
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
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
      sleepSync(delay)
    }
  }

  throw lastError
}
