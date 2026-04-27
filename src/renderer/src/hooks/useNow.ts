import { useState, useEffect } from 'react'

/**
 * Module-level singleton so all subscribers share one timer.
 * The interval fires every 10 seconds and notifies every mounted component
 * that called `useNow()`. This keeps the interval alive for the app's
 * lifetime — the cost is one lightweight 10s tick, which is acceptable.
 */
const TICK_INTERVAL_MS = 10_000

const listeners = new Set<() => void>()
let cachedNow = Date.now()

setInterval(() => {
  cachedNow = Date.now()
  listeners.forEach((notify) => notify())
}, TICK_INTERVAL_MS)

/**
 * Returns the current timestamp, updated at a coarse 10-second interval.
 *
 * Use this instead of calling `Date.now()` directly in a render body.
 * Because all TaskPill instances share the same interval, React.memo can
 * prevent re-renders between ticks when task data has not changed.
 */
export function useNow(): number {
  const [now, setNow] = useState(cachedNow)

  useEffect(() => {
    const notify = (): void => setNow(Date.now())
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [])

  return now
}
