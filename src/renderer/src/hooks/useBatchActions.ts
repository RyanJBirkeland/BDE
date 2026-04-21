import { useState } from 'react'
import { useConfirm } from '../components/ui/ConfirmModal'
import { useBatchReviewActions } from './useBatchReviewActions'
import type { SprintTask } from '../../../shared/types'

export type BatchActionKey = 'batchMerge' | 'batchShip' | 'batchPr' | 'batchDiscard'

export interface UseBatchActionsResult {
  batchActionInFlight: BatchActionKey | null
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
  handleBatchMergeAll: (tasks: SprintTask[]) => Promise<void>
  handleBatchShipAll: (tasks: SprintTask[], ghConfigured: boolean) => Promise<void>
  handleBatchCreatePr: (tasks: SprintTask[], ghConfigured: boolean) => Promise<void>
  handleBatchDiscard: (tasks: SprintTask[]) => Promise<void>
}

function taskBulletList(tasks: SprintTask[]): string {
  return tasks.map((t) => `• ${t.title}`).join('\n')
}

export function useBatchActions(): UseBatchActionsResult {
  const [batchActionInFlight, setBatchActionInFlight] = useState<BatchActionKey | null>(null)
  const { confirm, confirmProps } = useConfirm()
  const { batchMergeLocally, batchShipIt, batchCreatePr, batchDiscard } = useBatchReviewActions()

  const handleBatchMergeAll = async (tasks: SprintTask[]): Promise<void> => {
    const ok = await confirm({
      title: `Merge ${tasks.length} Tasks`,
      message: `Merge all ${tasks.length} selected tasks into your local branch using squash strategy?\n\n${taskBulletList(tasks)}`,
      confirmLabel: 'Merge All',
      variant: 'default'
    })
    if (!ok) return

    setBatchActionInFlight('batchMerge')
    await batchMergeLocally(tasks)
    setBatchActionInFlight(null)
  }

  const handleBatchShipAll = async (tasks: SprintTask[], ghConfigured: boolean): Promise<void> => {
    if (!ghConfigured) return
    const ok = await confirm({
      title: `Ship ${tasks.length} Tasks`,
      message: `Merge all ${tasks.length} selected tasks into main using squash, push to origin, and mark done?\n\n${taskBulletList(tasks)}\n\nThis will merge + push in one step.`,
      confirmLabel: 'Ship All',
      variant: 'default'
    })
    if (!ok) return

    setBatchActionInFlight('batchShip')
    await batchShipIt(tasks)
    setBatchActionInFlight(null)
  }

  const handleBatchCreatePr = async (tasks: SprintTask[], ghConfigured: boolean): Promise<void> => {
    if (!ghConfigured) return
    const ok = await confirm({
      title: `Create ${tasks.length} PRs`,
      message: `Push branches to GitHub and create public PRs for all ${tasks.length} selected tasks?\n\n${taskBulletList(tasks)}\n\nThis action cannot be undone.`,
      confirmLabel: 'Create PRs',
      variant: 'default'
    })
    if (!ok) return

    setBatchActionInFlight('batchPr')
    await batchCreatePr(
      tasks.map((t) => ({ ...t, spec: t.spec ?? undefined, prompt: t.prompt ?? undefined }))
    )
    setBatchActionInFlight(null)
  }

  const handleBatchDiscard = async (tasks: SprintTask[]): Promise<void> => {
    const ok = await confirm({
      title: `Discard ${tasks.length} Tasks`,
      message: `Discard all work for ${tasks.length} selected tasks? This cannot be undone.\n\n${taskBulletList(tasks)}`,
      confirmLabel: 'Discard All',
      variant: 'danger'
    })
    if (!ok) return

    setBatchActionInFlight('batchDiscard')
    await batchDiscard(tasks)
    setBatchActionInFlight(null)
  }

  return {
    batchActionInFlight,
    confirmProps,
    handleBatchMergeAll,
    handleBatchShipAll,
    handleBatchCreatePr,
    handleBatchDiscard
  }
}
