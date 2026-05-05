import React from 'react'
import { Button } from '../../ui/Button'

interface OrphanRecoveryBannerProps {
  recoveredCount: number
  exhaustedCount: number
  onDismiss: () => void
}

export function OrphanRecoveryBanner({
  recoveredCount,
  exhaustedCount,
  onDismiss,
}: OrphanRecoveryBannerProps): React.JSX.Element {
  const leftBorderColor =
    exhaustedCount > 0 ? 'var(--st-failed)' : 'var(--st-running)'

  return (
    <div
      role="status"
      style={{
        background: 'var(--surf-1)',
        borderBottom: '1px solid var(--line)',
        borderLeft: `3px solid ${leftBorderColor}`,
        padding: 'var(--s-2) var(--s-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-3)',
        fontSize: 12,
        color: 'var(--fg-2)',
      }}
    >
      <span style={{ flex: 1 }}>
        {recoveredCount > 0 && (
          <span>
            {recoveredCount} task{recoveredCount !== 1 ? 's' : ''} recovered from crash and
            re-queued.{' '}
          </span>
        )}
        {exhaustedCount > 0 && (
          <span>
            {exhaustedCount} task{exhaustedCount !== 1 ? 's' : ''} exceeded the crash recovery
            limit and were marked as error.
          </span>
        )}
      </span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
