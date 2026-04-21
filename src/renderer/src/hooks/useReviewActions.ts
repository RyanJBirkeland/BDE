import { useConfirm } from '../components/ui/ConfirmModal'
import { useTextareaPrompt } from '../components/ui/TextareaPromptModal'
import { useSingleTaskReviewActions } from './useSingleTaskReviewActions'
import { useBatchReviewActions } from './useBatchReviewActions'

export interface ReviewActionsState {
  actionInFlight: string | null
  mergeStrategy: 'squash' | 'merge' | 'rebase'
  setMergeStrategy: (strategy: 'squash' | 'merge' | 'rebase') => void
  freshness: {
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number | undefined
  }
  ghConfigured: boolean
}

export interface ReviewActions {
  shipIt: () => Promise<void>
  mergeLocally: () => Promise<void>
  createPr: () => Promise<void>
  requestRevision: () => Promise<void>
  rebase: () => Promise<void>
  discard: () => Promise<void>
  getNextReviewTaskId: (currentTaskId: string) => string | null
  batchMergeLocally: (tasks: Array<{ id: string; title: string }>) => Promise<void>
  batchShipIt: (tasks: Array<{ id: string; title: string }>) => Promise<void>
  batchCreatePr: (
    tasks: Array<{ id: string; title: string; spec?: string; prompt?: string }>
  ) => Promise<void>
  batchDiscard: (tasks: Array<{ id: string; title: string }>) => Promise<void>
}

export interface UseReviewActionsResult extends ReviewActionsState, ReviewActions {
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
  promptProps: ReturnType<typeof useTextareaPrompt>['promptProps']
}

export function useReviewActions(): UseReviewActionsResult {
  const single = useSingleTaskReviewActions()
  const batch = useBatchReviewActions()

  return {
    ...single,
    ...batch
  }
}
