import { useState } from 'react'
import { GitMerge, GitPullRequest, RotateCcw, Trash2 } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { toast } from '../../stores/toasts'

export function ReviewActions(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const { confirm, confirmProps } = useConfirm()
  const [mergeStrategy, setMergeStrategy] = useState<'squash' | 'merge' | 'rebase'>('squash')

  if (!task || task.status !== 'review') {
    return (
      <div className="cr-actions">
        <span className="cr-actions__hint">Select a task in review to see actions</span>
        <ConfirmModal {...confirmProps} />
      </div>
    )
  }

  const handleMergeLocally = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Merge Locally',
      message: `Merge "${task.title.slice(0, 50)}" into your local main branch using ${mergeStrategy} strategy?`,
      confirmLabel: 'Merge',
      variant: 'default'
    })
    if (!ok) return
    try {
      const result = await window.api.review.mergeLocally({
        taskId: task.id,
        strategy: mergeStrategy
      })
      if (result.success) {
        toast.success('Changes merged locally')
        loadData()
      } else {
        toast.error(`Merge failed: ${result.error || 'conflicts detected'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    }
  }

  const handleCreatePr = async (): Promise<void> => {
    try {
      const result = await window.api.review.createPr({
        taskId: task.id,
        title: task.title,
        body: task.spec || task.prompt || ''
      })
      toast.success(`PR created: ${result.prUrl}`)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create PR')
    }
  }

  const handleRequestRevision = async (): Promise<void> => {
    const feedback = prompt('What should the agent fix or improve?')
    if (!feedback) return
    try {
      await window.api.review.requestRevision({
        taskId: task.id,
        feedback,
        mode: 'fresh'
      })
      toast.success('Task re-queued with revision feedback')
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to request revision')
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
    try {
      await window.api.review.discard({ taskId: task.id })
      toast.success('Changes discarded')
      useCodeReviewStore.getState().selectTask(null)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to discard')
    }
  }

  return (
    <div className="cr-actions">
      <div className="cr-actions__primary">
        <div className="cr-actions__merge-group">
          <button className="cr-actions__btn cr-actions__btn--primary" onClick={handleMergeLocally}>
            <GitMerge size={14} /> Merge Locally
          </button>
          <select
            className="cr-actions__strategy"
            value={mergeStrategy}
            onChange={(e) => setMergeStrategy(e.target.value as 'squash' | 'merge' | 'rebase')}
          >
            <option value="squash">Squash</option>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </select>
        </div>
        <button className="cr-actions__btn cr-actions__btn--secondary" onClick={handleCreatePr}>
          <GitPullRequest size={14} /> Create PR
        </button>
      </div>
      <div className="cr-actions__secondary">
        <button className="cr-actions__btn cr-actions__btn--ghost" onClick={handleRequestRevision}>
          <RotateCcw size={14} /> Revise
        </button>
        <button className="cr-actions__btn cr-actions__btn--danger" onClick={handleDiscard}>
          <Trash2 size={14} /> Discard
        </button>
      </div>
      <ConfirmModal {...confirmProps} />
    </div>
  )
}
