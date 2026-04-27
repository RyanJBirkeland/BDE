import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

const DISMISS_KEY = 'fleet:github-opted-out-dismissed'

/**
 * Surfaces a small banner whenever `settings.githubOptedOut === 'true'`, so
 * users who skipped GitHub during onboarding know PR features are intentionally
 * disabled. Dismissible per-session (cleared on reload). Cleared entirely if
 * the user later configures gh auth and toggles the setting off.
 */
export function GitHubOptedOutBanner(): React.JSX.Element | null {
  const [optedOut, setOptedOut] = useState(false)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    window.api.settings
      .get('githubOptedOut')
      .then((v) => setOptedOut(v === 'true'))
      .catch(() => setOptedOut(false))
  }, [])

  if (!optedOut || dismissed) return null

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--fleet-space-2)',
        padding: '6px 12px',
        margin: '0 0 var(--fleet-space-2) 0',
        background: 'var(--fleet-warning-surface, rgba(255,159,67,0.1))',
        border: '1px solid var(--fleet-warning, #ff9f43)',
        borderRadius: '4px',
        color: 'var(--fleet-text)',
        fontSize: 'var(--fleet-size-xs)'
      }}
    >
      <AlertTriangle size={14} color="var(--fleet-warning, #ff9f43)" />
      <span style={{ flex: 1 }}>
        GitHub disabled — PR actions unavailable. Enable in Onboarding or run{' '}
        <code>gh auth login</code>, then unset <code>githubOptedOut</code> in Settings.
      </span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* session-only dismiss — storage may be disabled in tests */
          }
          setDismissed(true)
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--fleet-text-muted)'
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
