import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import { toast } from '../stores/toasts'
import { useGitHubStatus } from './useGitHubStatus'
import { useReviewActionModals } from './useReviewActionModals'
import { useReviewActionState } from './useReviewActionState'
import { useReviewFreshness } from './useReviewFreshness'
import { useConfirm } from '../components/ui/ConfirmModal'
import { useTextareaPrompt } from '../components/ui/TextareaPromptModal'
import { nowIso } from '../../../shared/time'

function getNextReviewTaskId(
  currentTaskId: string,
  allTasks: Array<{ id: string; status: string; updated_at: string }>
): string | null {
  const reviewTasks = allTasks
    .filter((t) => t.status === 'review' && t.id !== currentTaskId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return reviewTasks.length > 0 && reviewTasks[0] ? reviewTasks[0].id : null
}

export interface UseSingleTaskReviewActionsResult {
  actionInFlight: string | null
  mergeStrategy: 'squash' | 'merge' | 'rebase'
  setMergeStrategy: (strategy: 'squash' | 'merge' | 'rebase') => void
  freshness: {
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number | undefined
  }
  ghConfigured: boolean
  /** Worktree path for the selected task — used by the conflict resolution "Open in IDE" path. */
  worktreePath: string | null | undefined
  /** Number of revision requests already made — enforces the 5-revision cap. */
  revisionCount: number
  shipIt: () => Promise<void>
  mergeLocally: () => Promise<void>
  createPr: () => Promise<void>
  requestRevision: () => Promise<void>
  rebase: () => Promise<void>
  discard: () => Promise<void>
  markShippedOutsideBde: () => Promise<void>
  getNextReviewTaskId: (currentTaskId: string) => string | null
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
  promptProps: ReturnType<typeof useTextareaPrompt>['promptProps']
}

export function useSingleTaskReviewActions(): UseSingleTaskReviewActionsResult {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)

  const { confirm, prompt, confirmProps, promptProps } = useReviewActionModals()
  const { mergeStrategy, setMergeStrategy, actionInFlight, setActionInFlight } =
    useReviewActionState()
  const { freshness, setFreshness } = useReviewFreshness(task?.id, task?.status, task?.rebased_at)
  const { configured: ghConfigured } = useGitHubStatus()

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
        if (!nextTaskId) toast.info('Review queue empty')
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
        if (!nextTaskId) toast.info('Review queue empty')
        loadData()
      } else {
        const conflictInfo = result.conflicts?.length
          ? `\n\nConflicting files:\n${result.conflicts.slice(0, 5).join('\n')}${result.conflicts.length > 5 ? `\n...and ${result.conflicts.length - 5} more` : ''}`
          : ''
        toast.error(`Merge failed: ${result.error || 'conflicts detected'}${conflictInfo}`, 10000)
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
      toast.info(`PR created`, {
        action: 'Open PR',
        onAction: () => window.open(result.prUrl, '_blank')
      })
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      if (!nextTaskId) toast.info('Review queue empty')
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
      placeholder: 'Describe what needs to change — the agent will see this directly...',
      confirmLabel: 'Send to Agent'
    })
    if (!feedback) return
    setActionInFlight('revise')
    try {
      const priorEntries = Array.isArray(task.revision_feedback) ? task.revision_feedback : []
      const nextEntries = [
        ...priorEntries,
        {
          timestamp: nowIso(),
          feedback,
          attempt: priorEntries.length + 1
        }
      ]
      await window.api.sprint.update(task.id, { revision_feedback: nextEntries })
      await window.api.review.requestRevision({
        taskId: task.id,
        feedback,
        mode: 'fresh'
      })
      toast.success('Revision requested — agent will re-run with your feedback')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      if (!nextTaskId) toast.info('Review queue empty')
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
      title: 'Discard Task',
      message: `Discard this task? The worktree will be permanently deleted. This cannot be undone.`,
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
      if (!nextTaskId) toast.info('Review queue empty')
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to discard')
    } finally {
      setActionInFlight(null)
    }
  }

  const markShippedOutsideBde = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Mark Shipped Outside BDE',
      message: `Mark "${task.title.slice(0, 50)}" as done? Use this when you merged or deployed the work outside of BDE.`,
      confirmLabel: 'Mark Done',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('markShipped')
    try {
      await window.api.review.markShippedOutsideBde({ taskId: task.id })
      toast.success('Task marked as shipped')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      if (!nextTaskId) toast.info('Review queue empty')
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark shipped')
    } finally {
      setActionInFlight(null)
    }
  }

  return {
    actionInFlight,
    mergeStrategy,
    setMergeStrategy,
    freshness,
    ghConfigured,
    worktreePath: task?.worktree_path,
    revisionCount: Array.isArray(task?.revision_feedback) ? task.revision_feedback.length : 0,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    markShippedOutsideBde,
    getNextReviewTaskId: (currentTaskId: string) => getNextReviewTaskId(currentTaskId, tasks),
    confirmProps,
    promptProps
  }
}
