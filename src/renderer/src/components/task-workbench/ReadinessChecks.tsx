import { useCallback } from 'react'
import { Check, AlertTriangle, X, Loader2, CheckCircle2 } from 'lucide-react'
import { useTaskWorkbenchStore, type CheckResult } from '../../stores/taskWorkbench'
import { NeonCard } from '../neon/NeonCard'
import type { NeonAccent } from '../neon/types'

/**
 * Focus a form field by id and scroll it into view. Used by the readiness
 * check list so users can click a failure → land on the offending field.
 * Returns true if a field was found and focused.
 */
function focusFieldById(fieldId: string): boolean {
  const el = document.getElementById(fieldId)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    el.focus()
  } else {
    ;(el as HTMLElement).focus?.()
  }
  return true
}

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
  const hasWarnings = allChecks.some((c) => c.status === 'warn')
  const isLoading = semanticLoading || operationalLoading

  if (total === 0 && !isLoading) return null

  const failCount = allChecks.filter((c) => c.status === 'fail').length
  const warnCount = allChecks.filter((c) => c.status === 'warn').length
  const liveSummary = isLoading
    ? 'Running readiness checks…'
    : `${passing} of ${total} checks passing` +
      (failCount > 0 ? `, ${failCount} failing` : '') +
      (warnCount > 0 ? `, ${warnCount} warning${warnCount === 1 ? '' : 's'}` : '')

  // Dynamic accent based on check results
  const accent: NeonAccent = hasFailures ? 'red' : hasWarnings ? 'orange' : 'cyan'

  return (
    <NeonCard
      accent={accent}
      title="Readiness Checks"
      icon={<CheckCircle2 size={14} />}
      action={
        <button
          onClick={toggleExpanded}
          className="wb-checks__toggle"
          aria-expanded={expanded}
          aria-label="Toggle readiness checks details"
          style={{
            background: 'none',
            border: 'none',
            color: 'currentColor',
            cursor: 'pointer',
            padding: 0,
            fontSize: '14px'
          }}
        >
          {expanded ? '\u25be' : '\u25b8'}
        </button>
      }
      className="wb-checks-card"
    >
      {/* Screen-reader live announcer — visually hidden, updates on every check change */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveSummary}
      </div>
      <div className="wb-checks__summary-row">
        <span className="wb-checks__icons" aria-hidden="true">
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
      </div>
      {expanded && (
        <ul className="wb-checks__list">
          {allChecks.map((c) => (
            <CheckListItem key={c.id} check={c} />
          ))}
        </ul>
      )}
    </NeonCard>
  )
}

function CheckListItem({ check }: { check: CheckResult }): React.JSX.Element {
  const actionable = (check.status === 'fail' || check.status === 'warn') && !!check.fieldId
  const handleClick = useCallback(() => {
    if (check.fieldId) focusFieldById(check.fieldId)
  }, [check.fieldId])

  if (actionable) {
    return (
      <li>
        <button
          type="button"
          className="wb-checks__item wb-checks__item--actionable"
          onClick={handleClick}
          aria-label={`${check.status === 'fail' ? 'Failed' : 'Warning'}: ${check.label}. ${check.message}. Click to focus field.`}
        >
          <CheckIcon status={check.status} />
          <span className="wb-checks__item-label">{check.label}</span>
          <span className="wb-checks__item-msg">{check.message}</span>
        </button>
      </li>
    )
  }

  return (
    <li className="wb-checks__item">
      <CheckIcon status={check.status} />
      <span className="wb-checks__item-label">{check.label}</span>
      <span className="wb-checks__item-msg">{check.message}</span>
    </li>
  )
}
