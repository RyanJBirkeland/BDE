import { useState } from 'react'

export type MergeStrategy = 'squash' | 'merge' | 'rebase'

export interface UseReviewActionStateResult {
  mergeStrategy: MergeStrategy
  setMergeStrategy: (strategy: MergeStrategy) => void
  actionInFlight: string | null
  setActionInFlight: (action: string | null) => void
}

/**
 * Tracks per-action loading state (which action is currently running)
 * and the user's selected merge strategy for merge/ship operations.
 */
export function useReviewActionState(): UseReviewActionStateResult {
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('squash')
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)

  return { mergeStrategy, setMergeStrategy, actionInFlight, setActionInFlight }
}
