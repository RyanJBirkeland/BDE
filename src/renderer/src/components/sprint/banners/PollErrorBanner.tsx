import React from 'react'
import { Button } from '../../ui/Button'

interface PollErrorBannerProps {
  message: string
  loading: boolean
  onRetry: () => void
  onDismiss: () => void
}

export function PollErrorBanner({
  message,
  loading,
  onRetry,
  onDismiss,
}: PollErrorBannerProps): React.JSX.Element {
  return (
    <div
      role="alert"
      style={{
        background: 'var(--surf-1)',
        borderBottom: '1px solid var(--line)',
        borderLeft: '3px solid var(--st-failed)',
        padding: 'var(--s-2) var(--s-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-3)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>{message}</span>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={loading}>
        {loading ? 'Retrying…' : 'Retry'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
