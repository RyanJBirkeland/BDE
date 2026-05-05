import React from 'react'

interface DrainPausedBannerProps {
  reason: string
  affectedTaskCount: number
  pausedUntil: number
  now: number
}

export function DrainPausedBanner({
  reason,
  affectedTaskCount,
  pausedUntil,
  now,
}: DrainPausedBannerProps): React.JSX.Element {
  const secondsLeft = Math.max(0, Math.floor((pausedUntil - now) / 1000))
  return (
    <div
      role="alert"
      style={{
        background: 'var(--surf-1)',
        borderBottom: '1px solid var(--line)',
        borderLeft: '3px solid var(--st-blocked)',
        padding: 'var(--s-2) var(--s-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        fontSize: 12,
        color: 'var(--fg-2)',
      }}
    >
      <strong style={{ color: 'var(--fg)' }}>Drain loop paused:</strong>
      &nbsp;{reason} —{' '}
      <span style={{ fontFamily: 'var(--font-mono)' }}>{affectedTaskCount}</span> queued.{' '}
      {secondsLeft > 0 ? `Resuming in ${secondsLeft}s` : 'Resuming soon'}
    </div>
  )
}
