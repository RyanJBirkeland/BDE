import { useState, useEffect } from 'react'

export type FreshnessStatus = 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'

export interface Freshness {
  status: FreshnessStatus
  commitsBehind?: number | undefined
}

export interface UseReviewFreshnessResult {
  freshness: Freshness
  setFreshness: (freshness: Freshness) => void
}

/**
 * Fetches and tracks whether the agent branch is fresh, stale, or in conflict
 * relative to main. Re-fetches whenever the task id or rebased_at timestamp changes.
 */
export function useReviewFreshness(
  taskId: string | undefined,
  taskStatus: string | undefined,
  rebasedAt: string | null | undefined
): UseReviewFreshnessResult {
  const [freshness, setFreshness] = useState<Freshness>({ status: 'loading' })

  useEffect(() => {
    if (!taskId || taskStatus !== 'review') return
    let cancelled = false
    window.api.review
      .checkFreshness({ taskId })
      .then((result) => {
        if (!cancelled) setFreshness(result)
      })
      .catch(() => {
        if (!cancelled) setFreshness({ status: 'unknown' })
      })
    return () => {
      cancelled = true
    }
  }, [taskId, rebasedAt, taskStatus])

  return { freshness, setFreshness }
}
