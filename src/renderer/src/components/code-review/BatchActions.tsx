import './ReviewQueue.css'
import { useState } from 'react'
import { GitMerge, Loader2, X } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { toast } from '../../stores/toasts'

export function BatchActions(): React.JSX.Element | null {
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const { confirm, confirmProps } = useConfirm()
  const [merging, setMerging] = useState(false)

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')

  if (selectedTasks.length === 0) return null

  const handleMergeAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Merge ${selectedTasks.length} Tasks`,
      message: `Merge all ${selectedTasks.length} selected tasks into your local branch using squash strategy?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}`,
      confirmLabel: 'Merge All',
      variant: 'default'
    })
    if (!ok) return

    setMerging(true)
    let succeeded = 0
    let failed = 0

    for (const task of selectedTasks) {
      try {
        const result = await window.api.review.mergeLocally({
          taskId: task.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    setMerging(false)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Merged ${succeeded} tasks`)
    } else {
      toast.error(`Merged ${succeeded}, failed ${failed}`)
    }
  }

  return (
    <div className="cr-batch">
      <span className="cr-batch__count">{selectedTasks.length} selected</span>
      <button
        className="cr-actions__btn cr-actions__btn--primary"
        onClick={handleMergeAll}
        disabled={merging}
      >
        {merging ? <Loader2 size={14} className="spin" /> : <GitMerge size={14} />} Merge All
      </button>
      <button
        className="cr-actions__btn cr-actions__btn--ghost"
        onClick={clearBatch}
        disabled={merging}
      >
        <X size={14} /> Clear
      </button>
      <ConfirmModal {...confirmProps} />
    </div>
  )
}
