import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

interface WorkbenchActionsProps {
  onSaveBacklog: () => void
  onQueueNow: () => void
  submitting: boolean
}

export function WorkbenchActions({ onSaveBacklog, onQueueNow, submitting }: WorkbenchActionsProps) {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)

  const titlePasses = structural.some((c) => c.id === 'title-present' && c.status === 'pass')
  const allTier1Pass = structural.every((c) => c.status === 'pass')
  const tier3HasFails = operational.some((c) => c.status === 'fail')

  const canSave = titlePasses
  const canQueue = allTier1Pass && !tier3HasFails

  return (
    <div style={{ display: 'flex', gap: tokens.space[2], justifyContent: 'flex-end' }}>
      <button onClick={onSaveBacklog} disabled={!canSave || submitting} style={{
        background: 'none', border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md, color: canSave ? tokens.color.text : tokens.color.textDim,
        padding: `${tokens.space[2]} ${tokens.space[4]}`, fontSize: tokens.size.md,
        cursor: canSave && !submitting ? 'pointer' : 'not-allowed',
      }}>
        Save to Backlog
      </button>
      <button onClick={onQueueNow} disabled={!canQueue || submitting} style={{
        background: canQueue ? tokens.color.accent : tokens.color.surfaceHigh, border: 'none',
        borderRadius: tokens.radius.md, color: canQueue ? '#000' : tokens.color.textDim,
        padding: `${tokens.space[2]} ${tokens.space[4]}`, fontSize: tokens.size.md,
        fontWeight: 600, cursor: canQueue && !submitting ? 'pointer' : 'not-allowed',
      }}>
        {submitting ? 'Creating...' : 'Queue Now'}
      </button>
    </div>
  )
}
