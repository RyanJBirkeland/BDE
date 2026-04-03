import { Check, AlertTriangle, X, Loader2 } from 'lucide-react'
import { useTaskWorkbenchStore, type CheckResult } from '../../stores/taskWorkbench'

const STATUS_ICON_MAP: Record<
  CheckResult['status'],
  { Icon: typeof Check; className: string; label: string }
> = {
  pass: { Icon: Check, className: 'wb-check-icon--pass', label: 'Passed' },
  warn: { Icon: AlertTriangle, className: 'wb-check-icon--warn', label: 'Warning' },
  fail: { Icon: X, className: 'wb-check-icon--fail', label: 'Failed' },
  pending: { Icon: Loader2, className: 'wb-check-icon--pending', label: 'Pending' }
}

function CheckIcon({ status }: { status: CheckResult['status'] }): React.JSX.Element {
  const { Icon, className, label } = STATUS_ICON_MAP[status]
  return (
    <span className={`wb-check-icon ${className}`} aria-label={label} role="img">
      <Icon size={14} />
    </span>
  )
}

export function ReadinessChecks(): React.JSX.Element | null {
  const structural = useTaskWorkbenchStore((s) => s.structuralChecks)
  const semantic = useTaskWorkbenchStore((s) => s.semanticChecks)
  const operational = useTaskWorkbenchStore((s) => s.operationalChecks)
  const semanticLoading = useTaskWorkbenchStore((s) => s.semanticLoading)
  const operationalLoading = useTaskWorkbenchStore((s) => s.operationalLoading)
  const expanded = useTaskWorkbenchStore((s) => s.checksExpanded)
  const toggleExpanded = useTaskWorkbenchStore((s) => s.toggleChecksExpanded)

  const allChecks = [...structural, ...semantic, ...operational]
  const passing = allChecks.filter((c) => c.status === 'pass').length
  const total = allChecks.length
  const hasFailures = allChecks.some((c) => c.status === 'fail')
  const isLoading = semanticLoading || operationalLoading

  if (total === 0 && !isLoading) return null

  return (
    <div className={`wb-checks${hasFailures ? ' wb-checks--has-fail' : ''}`}>
      <button
        onClick={toggleExpanded}
        className="wb-checks__summary"
        aria-expanded={expanded}
        aria-label="Toggle readiness checks"
      >
        <span>{expanded ? '\u25be' : '\u25b8'}</span>
        <span className="wb-checks__icons">
          {isLoading && (
            <span title="Running checks..." className="wb-check-icon wb-check-icon--pending">
              <Loader2 size={14} className="wb-spinner" />
            </span>
          )}
          {allChecks.map((c) => (
            <span key={c.id} title={c.label}>
              <CheckIcon status={c.status} />
            </span>
          ))}
        </span>
        <span className="wb-checks__count">
          {isLoading ? 'Checking...' : `${passing}/${total} passing`}
        </span>
      </button>
      {expanded && (
        <div className="wb-checks__list">
          {allChecks.map((c) => (
            <div key={c.id} className="wb-checks__item">
              <CheckIcon status={c.status} />
              <span className="wb-checks__item-label">{c.label}</span>
              <span className="wb-checks__item-msg">{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
