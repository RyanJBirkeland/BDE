import { useEffect, useRef } from 'react'

/**
 * Like setInterval, but pauses when the document is hidden and fires
 * the callback immediately when visibility returns.
 *
 * Pass `null` for intervalMs to disable the interval entirely.
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  intervalMs: number | null
): void {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (intervalMs === null) return

    let timer: ReturnType<typeof setInterval> | null = null

    function start(): void {
      stop()
      timer = setInterval(() => savedCallback.current(), intervalMs!)
    }

    function stop(): void {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        stop()
      } else {
        savedCallback.current() // immediate refresh on resume
        start()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [intervalMs])
}
