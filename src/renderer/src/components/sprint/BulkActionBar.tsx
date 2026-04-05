import { useState } from 'react'
import { XCircle, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { AssignEpicPopover } from './AssignEpicPopover'
import type { BatchOperation } from '../../../../shared/types'

interface BulkActionBarProps {
  selectedCount: number
  selectedTaskIds: Set<string>
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  selectedTaskIds,
  onClearSelection
}: BulkActionBarProps): React.JSX.Element | null {
  const [loading, setLoading] = useState(false)

  if (selectedCount === 0) return null

  const handleBulkAction = async (
    action: 'cancel' | 'requeue' | 'delete',
    actionLabel: string
  ): Promise<void> => {
    setLoading(true)
    try {
      const operations: BatchOperation[] = Array.from(selectedTaskIds).map((id) => {
        if (action === 'delete') {
          return { op: 'delete' as const, id }
        } else {
          const patch =
            action === 'cancel'
              ? { status: 'cancelled' }
              : action === 'requeue'
                ? { status: 'queued' }
                : {}
          return { op: 'update' as const, id, patch }
        }
      })

      const { results } = await window.api.sprint.batchUpdate(operations)
      const failed = results.filter((r) => !r.ok)

      if (failed.length === 0) {
        toast.success(`${actionLabel} ${selectedCount} task${selectedCount > 1 ? 's' : ''}`)
        onClearSelection()
      } else {
        toast.error(
          `${actionLabel} failed for ${failed.length} task${failed.length > 1 ? 's' : ''}`
        )
      }
    } catch (err) {
      toast.error(`Bulk ${actionLabel.toLowerCase()} failed: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bulk-action-bar" data-testid="bulk-action-bar">
      <div className="bulk-action-bar__info">
        <span className="bulk-action-bar__count">
          {selectedCount} task{selectedCount > 1 ? 's' : ''} selected
        </span>
      </div>
      <div className="bulk-action-bar__actions">
        <AssignEpicPopover selectedTaskIds={selectedTaskIds} onAssignComplete={onClearSelection} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleBulkAction('cancel', 'Cancelled')}
          disabled={loading}
          title="Cancel selected tasks"
        >
          <XCircle size={14} />
          Cancel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleBulkAction('requeue', 'Requeued')}
          disabled={loading}
          title="Requeue selected tasks"
        >
          <RotateCcw size={14} />
          Requeue
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => handleBulkAction('delete', 'Deleted')}
          disabled={loading}
          title="Delete selected tasks"
        >
          <Trash2 size={14} />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          disabled={loading}
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  )
}
