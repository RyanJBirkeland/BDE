import { useEffect, useRef } from 'react'

interface BackoffOptions {
  /** Maximum interval after repeated errors (default: 5x baseMs) */
  maxMs?: number
  /** Random jitter added to each interval (default: 10% of baseMs) */
  jitterMs?: number
  /** Multiplier on error (default: 2) */
  backoffFactor?: number
}

/**
 * Like setInterval but with exponential backoff on errors and jitter.
 * - callback returns void or Promise<void>
 * - if callback throws/rejects, interval increases by backoffFactor (up to maxMs)
 * - on success, interval resets to baseMs + random jitter
 * - pauses when document is hidden, fires soon after becoming visible
 */
export function useBackoffInterval(
  callback: () => void | Promise<void>,
  baseMs: number,
  options: BackoffOptions = {}
): void {
  const { maxMs = baseMs * 5, jitterMs = Math.round(baseMs * 0.1), backoffFactor = 2 } = options

  const savedCallback = useRef(callback)
  const currentInterval = useRef(baseMs)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
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
        currentInterval.current = baseMs
      } catch {
        currentInterval.current = Math.min(currentInterval.current * backoffFactor, maxMs)
      }
      schedule()
    }

    function schedule(): void {
      if (cancelled) return
      timerRef.current = setTimeout(tick, currentInterval.current + jitter())
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
  }, [baseMs, maxMs, jitterMs, backoffFactor])
}
