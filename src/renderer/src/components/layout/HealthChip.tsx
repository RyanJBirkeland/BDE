import './HealthChip.css'

type ManagerState = 'running' | 'error' | 'idle'

interface HealthChipProps {
  managerState: ManagerState
  activeCount: number
  queuedCount: number
  failedCount: number
  onClick: () => void
}

export function HealthChip({
  managerState,
  activeCount,
  queuedCount,
  failedCount,
  onClick,
}: HealthChipProps): React.JSX.Element {
  const totalCount = activeCount + queuedCount
  const ariaLabel =
    `Agent manager: ${managerState}. ` +
    `${activeCount} active, ${queuedCount} queued` +
    (failedCount > 0 ? `, ${failedCount} failed` : '') +
    '. Click to view pipeline.'

  return (
    <button
      className="health-chip"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid="health-chip"
    >
      {activeCount > 0 && <span className="fleet-pulse" style={{ width: 6, height: 6 }} />}
      <span className="health-chip__counts">
        <span className="health-chip__active">{activeCount}</span>
        <span className="health-chip__separator">/</span>
        <span>{totalCount}</span>
      </span>
      {queuedCount > 0 && (
        <>
          <span className="health-chip__separator">·</span>
          <span className="health-chip__queued">{queuedCount}q</span>
        </>
      )}
      {failedCount > 0 && (
        <>
          <span className="health-chip__separator">·</span>
          <span className="health-chip__failed">{failedCount}!</span>
        </>
      )}
    </button>
  )
}
