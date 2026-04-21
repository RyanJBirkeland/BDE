import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useTaskWorkbenchValidation } from '../../stores/taskWorkbenchValidation'
import './WorkbenchActions.css'

interface WorkbenchActionsProps {
  onSaveBacklog: () => void
  onQueueNow: () => void
  onCancel?: (() => void) | undefined
  submitting: boolean
}

export function WorkbenchActions({
  onSaveBacklog,
  onQueueNow,
  onCancel,
  submitting
}: WorkbenchActionsProps): React.JSX.Element {
  const mode = useTaskWorkbenchStore((s) => s.mode)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const structural = useTaskWorkbenchValidation((s) => s.structuralChecks)
  const operational = useTaskWorkbenchValidation((s) => s.operationalChecks)

  const titlePasses = structural.some((c) => c.id === 'title-present' && c.status === 'pass')
  const noTier1Fails = structural.every((c) => c.status !== 'fail')
  const tier3HasFails = operational.some((c) => c.status === 'fail')

  const missingRepo = !repo
  const specTooShort = spec.trim().length < 50

  const canSave = titlePasses
  const canQueue = noTier1Fails && !tier3HasFails && !missingRepo && !specTooShort

  // Build tooltip explaining why queue is disabled
  const queueDisabledReasons: string[] = []
  if (missingRepo) queueDisabledReasons.push('Select a repository')
  if (specTooShort) queueDisabledReasons.push('Spec must be at least 50 characters')
  if (!noTier1Fails) queueDisabledReasons.push('Fix failing readiness checks')
  if (tier3HasFails) queueDisabledReasons.push('Fix failing operational checks')
  const queueTooltip = queueDisabledReasons.length > 0 ? queueDisabledReasons.join('. ') : undefined

  return (
    <div className="wb-actions">
      {mode === 'edit' && onCancel && (
        <button
          onClick={onCancel}
          disabled={submitting}
          className="wb-actions__btn wb-actions__btn--ghost"
          aria-label="Discard changes and cancel editing"
        >
          Cancel
        </button>
      )}
      <button
        onClick={onSaveBacklog}
        disabled={!canSave || submitting}
        className="wb-actions__btn wb-actions__btn--secondary"
        aria-label="Save task to backlog"
      >
        {mode === 'edit' ? 'Save Changes' : 'Save to Backlog'}
      </button>
      <div className="wb-actions__queue-wrapper">
        <button
          onClick={onQueueNow}
          disabled={!canQueue || submitting}
          className="wb-actions__btn wb-actions__btn--primary"
          aria-label="Add task to queue"
          title={queueTooltip}
        >
          {submitting ? 'Creating...' : 'Queue Now'}
        </button>
        {!submitting && queueDisabledReasons.length > 0 && (
          <span className="wb-actions__hint">{queueDisabledReasons[0]}</span>
        )}
      </div>
    </div>
  )
}
