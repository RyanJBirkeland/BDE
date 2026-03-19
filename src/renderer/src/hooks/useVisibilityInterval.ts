import { useEffect, useRef } from 'react'

/**
 * Like setInterval, but skips ticks while the page is hidden
 * (document.visibilityState !== 'visible'). Fires the callback
 * immediately when the page becomes visible again after being hidden.
 */
export function useVisibilityInterval(
  callback: () => void,
  delayMs: number
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    function start(): void {
      if (timer) return
      timer = setInterval(() => callbackRef.current(), delayMs)
    }

    function stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') {
        callbackRef.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') {
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [delayMs])
}
