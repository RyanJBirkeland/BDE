import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import { toast } from '../stores/toasts'

export interface UseBatchReviewActionsResult {
  batchMergeLocally: (tasks: Array<{ id: string; title: string }>) => Promise<void>
  batchShipIt: (tasks: Array<{ id: string; title: string }>) => Promise<void>
  batchCreatePr: (
    tasks: Array<{ id: string; title: string; spec?: string; prompt?: string }>
  ) => Promise<void>
  batchDiscard: (tasks: Array<{ id: string; title: string }>) => Promise<void>
}

async function executeBatchAction<T>(
  tasks: T[],
  action: (task: T) => Promise<boolean>,
  successMessage: (count: number) => string,
  failureMessage: (succeeded: number, failed: number) => string,
  afterAll: () => void
): Promise<void> {
  let succeeded = 0
  let failed = 0

  for (const task of tasks) {
    try {
      const ok = await action(task)
      if (ok) succeeded++
      else failed++
    } catch {
      failed++
    }
  }

  afterAll()

  if (failed === 0) {
    toast.success(successMessage(succeeded))
  } else {
    toast.error(failureMessage(succeeded, failed))
  }
}

export function useBatchReviewActions(): UseBatchReviewActionsResult {
  const loadData = useSprintTasks((s) => s.loadData)

  function afterBatch(): void {
    useCodeReviewStore.getState().clearBatch()
    loadData()
  }

  const batchMergeLocally = (batchTasks: Array<{ id: string; title: string }>): Promise<void> =>
    executeBatchAction(
      batchTasks,
      async (task) => {
        const result = await window.api.review.mergeLocally({ taskId: task.id, strategy: 'squash' })
        return result.success
      },
      (n) => `Merged ${n} tasks`,
      (s, f) => `Merged ${s}, failed ${f}`,
      afterBatch
    )

  const batchShipIt = (batchTasks: Array<{ id: string; title: string }>): Promise<void> =>
    executeBatchAction(
      batchTasks,
      async (task) => {
        const result = await window.api.review.shipIt({ taskId: task.id, strategy: 'squash' })
        return result.success
      },
      (n) => `Shipped ${n} tasks`,
      (s, f) => `Shipped ${s}, failed ${f}`,
      afterBatch
    )

  const batchCreatePr = (
    batchTasks: Array<{ id: string; title: string; spec?: string; prompt?: string }>
  ): Promise<void> =>
    executeBatchAction(
      batchTasks,
      async (task) => {
        await window.api.review.createPr({
          taskId: task.id,
          title: task.title,
          body: task.spec || task.prompt || ''
        })
        return true
      },
      (n) => `Created ${n} PRs`,
      (s, f) => `Created ${s} PRs, failed ${f}`,
      afterBatch
    )

  const batchDiscard = (batchTasks: Array<{ id: string; title: string }>): Promise<void> =>
    executeBatchAction(
      batchTasks,
      async (task) => {
        await window.api.review.discard({ taskId: task.id })
        return true
      },
      (n) => `Discarded ${n} tasks`,
      (s, f) => `Discarded ${s} tasks, failed ${f}`,
      afterBatch
    )

  return {
    batchMergeLocally,
    batchShipIt,
    batchCreatePr,
    batchDiscard
  }
}
