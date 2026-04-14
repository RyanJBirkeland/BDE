import { useState, useEffect } from 'react'

export type FreshnessStatus = 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'

export interface Freshness {
  status: FreshnessStatus
  commitsBehind?: number
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
    setFreshness({ status: 'loading' })
    window.api.review
      .checkFreshness({ taskId })
      .then(setFreshness)
      .catch(() => setFreshness({ status: 'unknown' }))
  }, [taskId, rebasedAt, taskStatus])

  return { freshness, setFreshness }
}
