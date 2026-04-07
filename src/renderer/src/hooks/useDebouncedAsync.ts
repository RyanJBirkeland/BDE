import { useEffect, useRef } from 'react'

interface DebouncedAsyncOptions {
  /** Delay in milliseconds before executing callback (default: 1000) */
  delayMs?: number
  /** Called immediately when dependencies change, before debounce delay */
  onStart?: () => void
  /** Called after callback completes (success or error) */
  onEnd?: () => void
}

/**
 * Debounces an async callback that depends on reactive values.
 *
 * - Calls `onStart` immediately when dependencies change
 * - Waits `delayMs` after dependencies change before executing callback
 * - Cancels pending execution if dependencies change again
 * - Calls `onEnd` after callback completes (regardless of success/error)
 *
 * Typical pattern for loading states:
 * ```tsx
 * useDebouncedAsync(
 *   async () => {
 *     const result = await apiCall(value)
 *     setResults(result)
 *   },
 *   [value],
 *   {
 *     delayMs: 2000,
 *     onStart: () => setLoading(true),
 *     onEnd: () => setLoading(false)
 *   }
 * )
 * ```
 */
export function useDebouncedAsync(
  callback: () => Promise<void> | void,
  dependencies: unknown[],
  options: DebouncedAsyncOptions = {}
): void {
  const { delayMs = 1000, onStart, onEnd } = options

  const savedCallback = useRef(callback)
  const savedOnStart = useRef(onStart)
  const savedOnEnd = useRef(onEnd)

  // Keep refs fresh without triggering re-runs
  useEffect(() => {
    savedCallback.current = callback
    savedOnStart.current = onStart
    savedOnEnd.current = onEnd
  })

  useEffect(() => {
    let cancelled = false

    // Call onStart immediately when dependencies change
    savedOnStart.current?.()

    const timer = setTimeout(async () => {
      if (cancelled) return

      try {
        await savedCallback.current()
      } catch {
        // Swallow errors — callback should handle its own error state
      } finally {
        if (!cancelled) {
          savedOnEnd.current?.()
        }
      }
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, delayMs])
}
