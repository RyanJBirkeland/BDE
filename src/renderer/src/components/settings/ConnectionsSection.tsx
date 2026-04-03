/**
 * ConnectionsSection — auth status and GitHub credential management.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CredentialForm, type CredentialField } from './CredentialForm'
import { SettingsCard } from './SettingsCard'

// --- Auth Status types ---
interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: string
}

const GITHUB_FIELDS: CredentialField[] = [
  {
    key: 'token',
    label: 'Personal Access Token',
    type: 'token',
    placeholder: 'ghp_...',
    savedPlaceholder: 'Token saved — enter new value to change'
  }
]

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function ConnectionsSection(): React.JSX.Element {
  // --- Auth status state ---
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  const refreshAuth = useCallback(async () => {
    setAuthLoading(true)
    try {
      const status = await window.api.authStatus()
      setAuthStatus(status)
    } catch {
      toast.error('Failed to check auth status')
    } finally {
      setAuthLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  // --- GitHub token state ---
  const [ghToken, setGhToken] = useState('')
  const [hasExistingGhToken, setHasExistingGhToken] = useState(false)
  const [ghDirty, setGhDirty] = useState(false)
  const [ghTesting, setGhTesting] = useState(false)
  const [ghTestResult, setGhTestResult] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    window.api.settings.get('github.token').then((v) => {
      setHasExistingGhToken(!!v)
    })
  }, [])

  const handleGhChange = useCallback((_key: string, value: string) => {
    setGhToken(value)
    setGhDirty(true)
    setGhTestResult(null)
  }, [])

  const handleGhSave = useCallback(async () => {
    if (!ghToken) return
    try {
      await window.api.settings.set('github.token', ghToken)
      setHasExistingGhToken(true)
      setGhToken('')
      setGhDirty(false)
      toast.success('GitHub token saved')
    } catch (e) {
      toast.error(
        `Failed to save GitHub token: ${e instanceof Error ? e.message : 'Unknown error'}`
      )
    }
  }, [ghToken])

  const handleGhTest = useCallback(async () => {
    setGhTesting(true)
    setGhTestResult(null)
    try {
      const result = await window.api.github.fetch('/user')
      setGhTestResult(result.ok ? 'success' : 'error')
      if (result.ok) {
        toast.success('GitHub token valid')
      } else {
        toast.error('GitHub token invalid')
      }
    } catch {
      setGhTestResult('error')
      toast.error('GitHub test failed')
    } finally {
      setGhTesting(false)
    }
  }, [])

  // --- Derive auth status ---
  let authBadgeVariant: 'success' | 'warning' | 'danger' = 'danger'
  let authBadgeLabel = 'Not Configured'
  let authCardStatus: { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' | 'error' } = {
    label: 'Disconnected',
    variant: 'error'
  }
  if (authStatus) {
    if (authStatus.tokenFound && !authStatus.tokenExpired) {
      authBadgeVariant = 'success'
      authBadgeLabel = 'Connected'
      authCardStatus = { label: 'Connected', variant: 'success' }
    } else if (authStatus.tokenFound && authStatus.tokenExpired) {
      authBadgeVariant = 'warning'
      authBadgeLabel = 'Token Expired'
      authCardStatus = { label: 'Token Expired', variant: 'warning' }
    }
  }

  const ghCardStatus: { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' | 'error' } = hasExistingGhToken
    ? { label: 'Token Saved', variant: 'success' }
    : { label: 'Not Configured', variant: 'error' }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Connections</h2>

      {/* Claude CLI Auth Card */}
      <SettingsCard
        icon={<div className="stg-card__icon stg-card__icon--purple">C</div>}
        title="Claude CLI Auth"
        subtitle="OAuth token for agent spawning"
        status={authCardStatus}
      >
        <div className="settings-field__row" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="settings-field__status">
            <Badge variant={authBadgeVariant} size="sm">
              {authBadgeLabel}
            </Badge>
            {authStatus?.expiresAt && (
              <span style={{ fontSize: 'var(--bde-size-sm)', color: 'var(--bde-text-muted)' }}>
                Expires: {formatExpiry(authStatus.expiresAt)}
              </span>
            )}
          </div>
          <div className="settings-field__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshAuth}
              disabled={authLoading}
              loading={authLoading}
              type="button"
            >
              <RefreshCw size={12} style={{ marginRight: 4 }} />
              Refresh
            </Button>
          </div>
        </div>
      </SettingsCard>

      {/* GitHub Card */}
      <SettingsCard
        icon={<div className="stg-card__icon stg-card__icon--neutral">G</div>}
        title="GitHub"
        subtitle="Personal Access Token for PR creation"
        status={ghCardStatus}
      >
        <CredentialForm
          title=""
          fields={GITHUB_FIELDS}
          values={{ token: ghToken }}
          hasExisting={{ token: hasExistingGhToken }}
          onChange={handleGhChange}
          onSave={handleGhSave}
          onTest={handleGhTest}
          dirty={ghDirty}
          saveDisabled={!ghDirty || !ghToken}
          testDisabled={ghTesting || (!ghToken && !hasExistingGhToken)}
          saving={false}
          testing={ghTesting}
          testResult={ghTestResult}
        />
      </SettingsCard>
    </section>
  )
}
