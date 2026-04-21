import { useEffect, useRef } from 'react'

interface BackoffOptions {
  /** Maximum interval after repeated errors (default: 5x baseMs) */
  maxMs?: number | undefined
  /** Random jitter added to each interval (default: 10% of baseMs) */
  jitterMs?: number | undefined
  /** Multiplier on error (default: 2) */
  backoffFactor?: number | undefined
}

/**
 * Like setInterval but with exponential backoff on errors and jitter.
 * - callback returns void or Promise<void>
 * - if callback throws/rejects, interval increases by backoffFactor (up to maxMs)
 * - on success, interval resets to baseMs + random jitter
 * - pauses when document is hidden, fires soon after becoming visible
 * - pass null for baseMs to disable the interval entirely
 */
export function useBackoffInterval(
  callback: () => void | Promise<void>,
  baseMs: number | null,
  options: BackoffOptions = {}
): void {
  const savedCallback = useRef(callback)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (baseMs === null) return

    const intervalMs: number = baseMs
    const maxMs = options.maxMs ?? intervalMs * 5
    const jitterMs = options.jitterMs ?? Math.round(intervalMs * 0.1)
    const backoffFactor = options.backoffFactor ?? 2
    let currentInterval = intervalMs

    let cancelled = false

    function jitter(): number {
      return Math.round(Math.random() * jitterMs)
    }

    async function tick(): Promise<void> {
      if (cancelled) return
      if (document.hidden) {
        schedule()
        return
      }
      try {
        await savedCallback.current()
        currentInterval = intervalMs
      } catch {
        currentInterval = Math.min(currentInterval * backoffFactor, maxMs)
      }
      schedule()
    }

    function schedule(): void {
      if (cancelled) return
      timerRef.current = setTimeout(tick, currentInterval + jitter())
    }

    // Initial fire with jitter offset
    timerRef.current = setTimeout(tick, jitter())

    function onVisibilityChange(): void {
      if (!document.hidden && !cancelled) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(tick, 100)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [baseMs, options.maxMs, options.jitterMs, options.backoffFactor])
}
