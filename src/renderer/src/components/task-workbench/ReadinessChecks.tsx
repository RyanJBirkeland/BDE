import { useTaskWorkbenchStore, type CheckResult } from '../../stores/taskWorkbench'

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
    <div className={`wb-checks${hasFailures ? ' wb-checks--has-fail' : ''}`}>
      <button onClick={toggleExpanded} className="wb-checks__summary" aria-expanded={expanded} aria-label="Toggle readiness checks">
        <span>{expanded ? '\u25be' : '\u25b8'}</span>
        <span className="wb-checks__icons">
          {allChecks.map((c) => (
            <span key={c.id} title={c.label}>
              {STATUS_ICONS[c.status]}
            </span>
          ))}
        </span>
        <span className="wb-checks__count">
          {passing}/{total} passing
        </span>
      </button>
      {expanded && (
        <div className="wb-checks__list">
          {allChecks.map((c) => (
            <div key={c.id} className="wb-checks__item">
              <span>{STATUS_ICONS[c.status]}</span>
              <span className="wb-checks__item-label">{c.label}</span>
              <span className="wb-checks__item-msg">{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
