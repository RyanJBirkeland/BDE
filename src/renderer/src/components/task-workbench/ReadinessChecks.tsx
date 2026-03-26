import { useTaskWorkbenchStore, type CheckResult } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

const STATUS_ICONS: Record<CheckResult['status'], string> = {
  pass: '\u2705',
  warn: '\u26a0\ufe0f',
  fail: '\u274c',
  pending: '\u23f3'
}

export function ReadinessChecks() {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const semantic = useTaskWorkbenchStore((s) => s.semanticChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)
  const expanded = useTaskWorkbenchStore((s) => s.checksExpanded)
  const toggleExpanded = useTaskWorkbenchStore((s) => s.toggleChecksExpanded)

  const allChecks = [...structural, ...semantic, ...operational]
  const passing = allChecks.filter((c) => c.status === 'pass').length
  const total = allChecks.length
  const hasFailures = allChecks.some((c) => c.status === 'fail')

  if (total === 0) return null

  return (
    <div
      style={{
        border: `1px solid ${hasFailures ? tokens.color.danger : tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space[3],
        background: tokens.color.surface
      }}
    >
      <button
        onClick={toggleExpanded}
        style={{
          background: 'none',
          border: 'none',
          color: tokens.color.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          width: '100%',
          fontSize: tokens.size.sm,
          padding: 0
        }}
      >
        <span>{expanded ? '\u25be' : '\u25b8'}</span>
        <span style={{ display: 'flex', gap: tokens.space[1] }}>
          {allChecks.map((c) => (
            <span key={c.id} title={c.label}>
              {STATUS_ICONS[c.status]}
            </span>
          ))}
        </span>
        <span style={{ color: tokens.color.textMuted, marginLeft: 'auto' }}>
          {passing}/{total} passing
        </span>
      </button>
      {expanded && (
        <div
          style={{
            marginTop: tokens.space[2],
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[1]
          }}
        >
          {allChecks.map((c) => (
            <div
              key={c.id}
              style={{ display: 'flex', gap: tokens.space[2], fontSize: tokens.size.sm }}
            >
              <span>{STATUS_ICONS[c.status]}</span>
              <span style={{ color: tokens.color.text, fontWeight: 500, minWidth: 80 }}>
                {c.label}
              </span>
              <span style={{ color: tokens.color.textMuted }}>{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
