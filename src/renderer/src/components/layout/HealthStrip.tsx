/**
 * HealthStrip — compact at-a-glance indicator of agent manager state.
 *
 * Shows a status dot plus micro-pills for active / queued / failed counts.
 * Clicking navigates to the Sprint Pipeline so users can drill into problems.
 */
import { neonVar } from '../neon/types'

export type HealthManagerState = 'running' | 'error' | 'idle'

interface HealthStripProps {
  managerState: HealthManagerState
  activeCount: number
  queuedCount: number
  failedCount: number
  onClick: () => void
}

const DOT_COLOR: Record<HealthManagerState, string> = {
  running: neonVar('cyan', 'color'),
  error: neonVar('red', 'color'),
  idle: 'var(--bde-text-dim, rgba(255,255,255,0.35))'
}

const DOT_LABEL: Record<HealthManagerState, string> = {
  running: 'Agent manager running',
  error: 'Agent manager has errors',
  idle: 'Agent manager idle'
}

export function HealthStrip({
  managerState,
  activeCount,
  queuedCount,
  failedCount,
  onClick
}: HealthStripProps): React.JSX.Element {
  const ariaLabel =
    `${DOT_LABEL[managerState]}. ` +
    `${activeCount} active, ${queuedCount} queued` +
    (failedCount > 0 ? `, ${failedCount} failed` : '') +
    `. Click to open Sprint Pipeline.`

  return (
    <button
      type="button"
      className="health-strip"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid="unified-header-health-strip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--bde-surface-raised, rgba(255,255,255,0.04))',
        border: '1px solid var(--bde-border, rgba(255,255,255,0.08))',
        cursor: 'pointer',
        font: 'inherit',
        color: 'var(--bde-text, rgba(255,255,255,0.85))',
        lineHeight: 1
      }}
    >
      <span
        data-testid="health-strip-dot"
        data-state={managerState}
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_COLOR[managerState],
          boxShadow:
            managerState === 'running' || managerState === 'error'
              ? `0 0 6px ${DOT_COLOR[managerState]}`
              : 'none'
        }}
      />
      <span
        data-testid="health-strip-active"
        style={{ fontSize: 11, color: neonVar('cyan', 'color') }}
      >
        {activeCount}
      </span>
      <span
        data-testid="health-strip-queued"
        style={{ fontSize: 11, color: 'var(--bde-text-dim, rgba(255,255,255,0.55))' }}
      >
        {queuedCount}
      </span>
      {failedCount > 0 && (
        <span
          data-testid="health-strip-failed"
          style={{
            fontSize: 11,
            color: neonVar('red', 'color'),
            fontWeight: 600
          }}
        >
          !{failedCount}
        </span>
      )}
    </button>
  )
}
