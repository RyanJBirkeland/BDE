import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'

interface WorkbenchActionsProps {
  onSaveBacklog: () => void
  onQueueNow: () => void
  onLaunch: () => void
  submitting: boolean
}

export function WorkbenchActions({
  onSaveBacklog,
  onQueueNow,
  onLaunch,
  submitting
}: WorkbenchActionsProps) {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)
  const semantic = useTaskWorkbenchStore((s) => s.semanticChecks)

  const titlePasses = structural.some((c) => c.id === 'title-present' && c.status === 'pass')
  const noTier1Fails = structural.every((c) => c.status !== 'fail')
  const tier3HasFails = operational.some((c) => c.status === 'fail')
  const semanticNoFails = semantic.length === 0 || semantic.every((c) => c.status !== 'fail')

  const canSave = titlePasses
  const canQueue = noTier1Fails && !tier3HasFails
  const canLaunch = noTier1Fails && semanticNoFails && !tier3HasFails

  return (
    <div className="wb-actions">
      <button
        onClick={onSaveBacklog}
        disabled={!canSave || submitting}
        className="wb-actions__btn wb-actions__btn--secondary"
        aria-label="Save task to backlog"
      >
        Save to Backlog
      </button>
      <button
        onClick={onQueueNow}
        disabled={!canQueue || submitting}
        className="wb-actions__btn wb-actions__btn--primary"
        aria-label="Add task to queue"
      >
        {submitting ? 'Creating...' : 'Queue Now'}
      </button>
      <button
        onClick={onLaunch}
        disabled={!canLaunch || submitting}
        className="wb-actions__btn wb-actions__btn--launch"
        aria-label="Launch task immediately"
      >
        {submitting ? 'Launching...' : 'Launch'}
      </button>
    </div>
  )
}
