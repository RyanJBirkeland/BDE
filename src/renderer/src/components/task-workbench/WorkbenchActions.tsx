import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

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
  const allTier1Pass = structural.every((c) => c.status === 'pass')
  const tier3HasFails = operational.some((c) => c.status === 'fail')
  const semanticNoFails = semantic.length === 0 || semantic.every((c) => c.status !== 'fail')

  const canSave = titlePasses
  const canQueue = allTier1Pass && !tier3HasFails
  const canLaunch = allTier1Pass && semanticNoFails && !tier3HasFails

  return (
    <div style={{ display: 'flex', gap: tokens.space[2], justifyContent: 'flex-end' }}>
      <button
        onClick={onSaveBacklog}
        disabled={!canSave || submitting}
        style={{
          background: 'none',
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          color: canSave ? tokens.color.text : tokens.color.textDim,
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          fontSize: tokens.size.md,
          cursor: canSave && !submitting ? 'pointer' : 'not-allowed'
        }}
      >
        Save to Backlog
      </button>
      <button
        onClick={onQueueNow}
        disabled={!canQueue || submitting}
        style={{
          background: canQueue ? tokens.color.accent : tokens.color.surfaceHigh,
          border: 'none',
          borderRadius: tokens.radius.md,
          color: canQueue ? 'var(--bde-btn-primary-text)' : tokens.color.textDim,
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          fontSize: tokens.size.md,
          fontWeight: 600,
          cursor: canQueue && !submitting ? 'pointer' : 'not-allowed'
        }}
      >
        {submitting ? 'Creating...' : 'Queue Now'}
      </button>
      <button
        onClick={onLaunch}
        disabled={!canLaunch || submitting}
        style={{
          background: canLaunch ? tokens.color.accent : tokens.color.surfaceHigh,
          border: 'none',
          borderRadius: tokens.radius.md,
          color: canLaunch ? 'var(--bde-btn-primary-text)' : tokens.color.textDim,
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          fontSize: tokens.size.md,
          fontWeight: 600,
          cursor: canLaunch && !submitting ? 'pointer' : 'not-allowed'
        }}
      >
        {submitting ? 'Launching...' : 'Launch'}
      </button>
    </div>
  )
}
