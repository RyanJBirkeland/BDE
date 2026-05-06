import { useState } from 'react'
import { XCircle, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSprintTasks } from '../../stores/sprintTasks'
import { AssignEpicPopover } from './AssignEpicPopover'

interface BulkActionBarProps {
  selectedCount: number
  selectedTaskIds: Set<string>
  onClearSelection: () => void
}

type BulkAction = 'cancel' | 'requeue' | 'delete'

export function BulkActionBar({
  selectedCount,
  selectedTaskIds,
  onClearSelection
}: BulkActionBarProps): React.JSX.Element | null {
  const [loading, setLoading] = useState(false)
  const batchCancelTasks = useSprintTasks((s) => s.batchCancelTasks)
  const batchRequeueTasks = useSprintTasks((s) => s.batchRequeueTasks)
  const batchDeleteTasks = useSprintTasks((s) => s.batchDeleteTasks)

  if (selectedCount === 0) return null

  const runBulkAction = async (action: BulkAction): Promise<void> => {
    setLoading(true)
    try {
      const ids = Array.from(selectedTaskIds)
      if (action === 'cancel') await batchCancelTasks(ids)
      else if (action === 'requeue') await batchRequeueTasks(ids)
      else await batchDeleteTasks(ids)
      onClearSelection()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      data-testid="bulk-action-bar"
      style={{
        background: 'var(--surf-2)',
        borderBottom: '1px solid var(--line-2)',
        padding: 'var(--s-2) var(--s-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-3)',
      }}
    >
      <span
        style={{
          padding: '1px var(--s-2)',
          background: 'color-mix(in oklch, var(--accent) 15%, transparent)',
          border: '1px solid color-mix(in oklch, var(--accent) 30%, transparent)',
          borderRadius: 999,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--fg)',
          flexShrink: 0,
        }}
      >
        {selectedCount} task{selectedCount > 1 ? 's' : ''} selected
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', flex: 1 }}>
        <AssignEpicPopover selectedTaskIds={selectedTaskIds} onAssignComplete={onClearSelection} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => runBulkAction('cancel')}
          disabled={loading}
          title="Cancel selected tasks"
        >
          <XCircle size={14} />
          Cancel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => runBulkAction('requeue')}
          disabled={loading}
          title="Requeue selected tasks"
        >
          <RotateCcw size={14} />
          Requeue
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => runBulkAction('delete')}
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
