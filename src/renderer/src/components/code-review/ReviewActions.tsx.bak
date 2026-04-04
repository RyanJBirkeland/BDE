import { useState } from 'react'
import { GitMerge, GitPullRequest, RotateCcw, Trash2, Loader2, Rocket } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { useTextareaPrompt, TextareaPromptModal } from '../ui/TextareaPromptModal'
import { toast } from '../../stores/toasts'

export function ReviewActions(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = useTextareaPrompt()
  const [mergeStrategy, setMergeStrategy] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)

  if (!task || task.status !== 'review') {
    return (
      <div className="cr-actions">
        <span className="cr-actions__hint">Select a task in review to see actions</span>
        <ConfirmModal {...confirmProps} />
        <TextareaPromptModal {...promptProps} />
      </div>
    )
  }

  const handleShipIt = async (): Promise<void> => {
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
        toast.success(result.pushed ? 'Merged & pushed!' : 'Merged locally (push failed — push manually)')
        selectTask(null)
        loadData()
      } else {
        toast.error(`Ship It failed: ${result.error || 'unknown error'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ship It failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleMergeLocally = async (): Promise<void> => {
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
        selectTask(null) // Clear selection after successful merge
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

  const handleShipIt = async (): Promise<void> => {
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
        toast.success(
          result.pushed ? 'Merged & pushed!' : 'Merged locally (push failed — push manually)'
        )
        selectTask(null)
        loadData()
      } else {
        toast.error(`Ship It failed: ${result.error || 'unknown error'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ship It failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleCreatePr = async (): Promise<void> => {
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
      selectTask(null) // Clear selection after successful PR creation
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create PR')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleRequestRevision = async (): Promise<void> => {
    const feedback = await prompt({
      title: 'Request Revision',
      message: 'What should the agent fix or improve?',
      placeholder: 'Describe the changes needed...',
      confirmLabel: 'Re-queue Task'
    })
    if (!feedback) return
    setActionInFlight('revise')
    try {
      await window.api.review.requestRevision({
        taskId: task.id,
        feedback,
        mode: 'fresh'
      })
      toast.success('Task re-queued with revision feedback')
      selectTask(null)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to request revision')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleDiscard = async (): Promise<void> => {
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
      selectTask(null)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to discard')
    } finally {
      setActionInFlight(null)
    }
  }

  return (
    <div className="cr-actions">
      <div className="cr-actions__primary">
        <button
          className="cr-actions__btn cr-actions__btn--ship"
          onClick={handleShipIt}
          disabled={!!actionInFlight}
        >
          {actionInFlight === 'shipIt' ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Rocket size={14} />
          )}{' '}
          Ship It
        </button>
        <div className="cr-actions__merge-group">
          <button
            className="cr-actions__btn cr-actions__btn--primary"
            onClick={handleMergeLocally}
            disabled={!!actionInFlight}
          >
            {actionInFlight === 'merge' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <GitMerge size={14} />
            )}{' '}
            Merge Locally
          </button>
          <select
            className="cr-actions__strategy"
            value={mergeStrategy}
            onChange={(e) => setMergeStrategy(e.target.value as 'squash' | 'merge' | 'rebase')}
            disabled={!!actionInFlight}
          >
            <option value="squash">Squash</option>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </select>
        </div>
        <button
          className="cr-actions__btn cr-actions__btn--secondary"
          onClick={handleCreatePr}
          disabled={!!actionInFlight}
        >
          {actionInFlight === 'createPr' ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <GitPullRequest size={14} />
          )}{' '}
          Create PR
        </button>
      </div>
      <div className="cr-actions__secondary">
        <button
          className="cr-actions__btn cr-actions__btn--ghost"
          onClick={handleRequestRevision}
          disabled={!!actionInFlight}
        >
          {actionInFlight === 'revise' ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <RotateCcw size={14} />
          )}{' '}
          Revise
        </button>
        <button
          className="cr-actions__btn cr-actions__btn--danger"
          onClick={handleDiscard}
          disabled={!!actionInFlight}
        >
          {actionInFlight === 'discard' ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Trash2 size={14} />
          )}{' '}
          Discard
        </button>
      </div>
      <ConfirmModal {...confirmProps} />
      <TextareaPromptModal {...promptProps} />
    </div>
  )
}
