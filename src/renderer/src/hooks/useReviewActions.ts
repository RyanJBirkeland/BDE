import { useState, useEffect } from 'react'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import { useConfirm } from '../components/ui/ConfirmModal'
import { useTextareaPrompt } from '../components/ui/TextareaPromptModal'
import { toast } from '../stores/toasts'
import { useGitHubStatus } from './useGitHubStatus'
import { nowIso } from '../../../shared/time'

/**
 * Compute the next review task after the current one.
 * Returns null if there are no more review tasks.
 */
function getNextReviewTaskId(
  currentTaskId: string,
  allTasks: Array<{ id: string; status: string; updated_at: string }>
): string | null {
  const reviewTasks = allTasks
    .filter((t) => t.status === 'review' && t.id !== currentTaskId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return reviewTasks.length > 0 ? reviewTasks[0].id : null
}

export interface ReviewActionsState {
  actionInFlight: string | null
  mergeStrategy: 'squash' | 'merge' | 'rebase'
  setMergeStrategy: (strategy: 'squash' | 'merge' | 'rebase') => void
  freshness: {
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number
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

/**
 * Shared hook for review action logic used by both ReviewActions and TopBar components.
 * Encapsulates all IPC calls, state management, and error handling for the six review actions.
 */
export function useReviewActions(): UseReviewActionsResult {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = useTextareaPrompt()
  const { configured: ghConfigured } = useGitHubStatus()
  const [mergeStrategy, setMergeStrategy] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)
  const [freshness, setFreshness] = useState<{
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number
  }>({ status: 'loading' })

  useEffect(() => {
    if (!task || task.status !== 'review') return
    setFreshness({ status: 'loading' })
    window.api.review
      .checkFreshness({ taskId: task.id })
      .then(setFreshness)
      .catch(() => setFreshness({ status: 'unknown' }))
  }, [task?.id, task?.rebased_at])

  const shipIt = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Ship It',
      message: `Merge "${task.title.slice(0, 50)}" into main using ${mergeStrategy}, push to origin, and mark done?\n\nThis will merge + push in one step.`,
      confirmLabel: 'Ship It',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('shipIt')
    try {
      const result = await window.api.review.shipIt({
        taskId: task.id,
        strategy: mergeStrategy
      })
      if (result.success) {
        // After the push-failure fix, shipIt never returns {success:true, pushed:false}.
        // A successful result means merged AND pushed — anything else returns
        // success:false with the task still in review for retry.
        toast.success('Merged & pushed!')
        const nextTaskId = getNextReviewTaskId(task.id, tasks)
        selectTask(nextTaskId)
        loadData()
      } else {
        toast.error(`Ship It failed: ${result.error || 'unknown error'}`, 10000)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ship It failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const mergeLocally = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Merge Locally',
      message: `Merge "${task.title.slice(0, 50)}" into your local main branch using ${mergeStrategy} strategy?`,
      confirmLabel: 'Merge',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('merge')
    try {
      const result = await window.api.review.mergeLocally({
        taskId: task.id,
        strategy: mergeStrategy
      })
      if (result.success) {
        toast.success('Changes merged locally')
        const nextTaskId = getNextReviewTaskId(task.id, tasks)
        selectTask(nextTaskId)
        loadData()
      } else {
        toast.error(`Merge failed: ${result.error || 'conflicts detected'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const createPr = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Create Pull Request',
      message: `Push agent branch to GitHub and create a public PR for "${task.title.slice(0, 50)}"?\n\nRepo: ${task.repo}\n\nThis action cannot be undone.`,
      confirmLabel: 'Create PR',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('createPr')
    try {
      const result = await window.api.review.createPr({
        taskId: task.id,
        title: task.title,
        body: task.spec || task.prompt || ''
      })
      toast.success(`PR created: ${result.prUrl}`)
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create PR')
    } finally {
      setActionInFlight(null)
    }
  }

  const requestRevision = async (): Promise<void> => {
    if (!task) return
    const feedback = await prompt({
      title: 'Request Revision',
      message: 'What should the agent fix or improve?',
      placeholder: 'Describe the changes needed...',
      confirmLabel: 'Re-queue Task'
    })
    if (!feedback) return
    setActionInFlight('revise')
    try {
      const priorEntries = Array.isArray(task.revision_feedback) ? task.revision_feedback : []
      const attempt = priorEntries.length + 1
      const nextEntries = [
        ...priorEntries,
        {
          timestamp: nowIso(),
          feedback,
          attempt
        }
      ]
      try {
        await window.api.sprint.update(task.id, { revision_feedback: nextEntries })
      } catch (err) {
        console.warn('[review] Failed to persist revision feedback (audit trail only):', err)
      }
      await window.api.review.requestRevision({
        taskId: task.id,
        feedback,
        mode: 'fresh'
      })
      toast.success('Task re-queued with revision feedback')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to request revision')
    } finally {
      setActionInFlight(null)
    }
  }

  const rebase = async (): Promise<void> => {
    if (!task) return
    setActionInFlight('rebase')
    try {
      const result = await window.api.review.rebase({ taskId: task.id })
      if (result.success) {
        toast.success('Rebased onto main')
        setFreshness({ status: 'fresh', commitsBehind: 0 })
        loadData()
      } else {
        toast.error(`Rebase failed: ${result.error || 'conflicts detected'}`)
        setFreshness({ status: 'conflict' })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rebase failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const discard = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Discard Changes',
      message: `Discard all work for "${task.title.slice(0, 50)}"? This cannot be undone.`,
      confirmLabel: 'Discard',
      variant: 'danger'
    })
    if (!ok) return
    setActionInFlight('discard')
    try {
      await window.api.review.discard({ taskId: task.id })
      toast.success('Changes discarded')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to discard')
    } finally {
      setActionInFlight(null)
    }
  }

  const batchMergeLocally = async (
    batchTasks: Array<{ id: string; title: string }>
  ): Promise<void> => {
    const clearBatch = useCodeReviewStore.getState().clearBatch
    let succeeded = 0
    let failed = 0

    for (const batchTask of batchTasks) {
      try {
        const result = await window.api.review.mergeLocally({
          taskId: batchTask.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Merged ${succeeded} tasks`)
    } else {
      toast.error(`Merged ${succeeded}, failed ${failed}`)
    }
  }

  const batchShipIt = async (batchTasks: Array<{ id: string; title: string }>): Promise<void> => {
    const clearBatch = useCodeReviewStore.getState().clearBatch
    let succeeded = 0
    let failed = 0

    for (const batchTask of batchTasks) {
      try {
        const result = await window.api.review.shipIt({
          taskId: batchTask.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Shipped ${succeeded} tasks`)
    } else {
      toast.error(`Shipped ${succeeded}, failed ${failed}`)
    }
  }

  const batchCreatePr = async (
    batchTasks: Array<{ id: string; title: string; spec?: string; prompt?: string }>
  ): Promise<void> => {
    const clearBatch = useCodeReviewStore.getState().clearBatch
    let succeeded = 0
    let failed = 0

    for (const batchTask of batchTasks) {
      try {
        await window.api.review.createPr({
          taskId: batchTask.id,
          title: batchTask.title,
          body: batchTask.spec || batchTask.prompt || ''
        })
        succeeded++
      } catch {
        failed++
      }
    }

    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Created ${succeeded} PRs`)
    } else {
      toast.error(`Created ${succeeded} PRs, failed ${failed}`)
    }
  }

  const batchDiscard = async (batchTasks: Array<{ id: string; title: string }>): Promise<void> => {
    const clearBatch = useCodeReviewStore.getState().clearBatch
    let succeeded = 0
    let failed = 0

    for (const batchTask of batchTasks) {
      try {
        await window.api.review.discard({ taskId: batchTask.id })
        succeeded++
      } catch {
        failed++
      }
    }

    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Discarded ${succeeded} tasks`)
    } else {
      toast.error(`Discarded ${succeeded} tasks, failed ${failed}`)
    }
  }

  return {
    actionInFlight,
    mergeStrategy,
    setMergeStrategy,
    freshness,
    ghConfigured,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    getNextReviewTaskId: (currentTaskId: string) => getNextReviewTaskId(currentTaskId, tasks),
    batchMergeLocally,
    batchShipIt,
    batchCreatePr,
    batchDiscard,
    confirmProps,
    promptProps
  }
}
