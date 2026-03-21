/**
 * ConnectionsSection — auth status, agent-manager settings, and GitHub credential management.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CredentialForm, type CredentialField } from './CredentialForm'

// --- Auth Status types ---
interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: string
}

// --- Agent Manager settings ---
interface AgentManagerSettings {
  maxConcurrent: string
  worktreeBase: string
  maxRuntimeMinutes: string
}

const DEFAULTS: AgentManagerSettings = {
  maxConcurrent: '3',
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMinutes: '60',
}

const GITHUB_FIELDS: CredentialField[] = [
  { key: 'token', label: 'Personal Access Token', type: 'token', placeholder: 'ghp_...', savedPlaceholder: 'Token saved — enter new value to change' },
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

  useEffect(() => { refreshAuth() }, [refreshAuth])

  // --- Agent Manager settings state ---
  const [amSettings, setAmSettings] = useState<AgentManagerSettings>(DEFAULTS)
  const [amDirty, setAmDirty] = useState(false)
  const [amSaving, setAmSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.settings.get('agentManager.maxConcurrent'),
      window.api.settings.get('agentManager.worktreeBase'),
      window.api.settings.get('agentManager.maxRuntimeMinutes'),
    ]).then(([maxConcurrent, worktreeBase, maxRuntimeMinutes]) => {
      setAmSettings({
        maxConcurrent: maxConcurrent || DEFAULTS.maxConcurrent,
        worktreeBase: worktreeBase || DEFAULTS.worktreeBase,
        maxRuntimeMinutes: maxRuntimeMinutes || DEFAULTS.maxRuntimeMinutes,
      })
    })
  }, [])

  const handleAmChange = useCallback(
    (key: keyof AgentManagerSettings, value: string) => {
      setAmSettings((prev) => ({ ...prev, [key]: value }))
      setAmDirty(true)
    },
    [],
  )

  const handleAmSave = useCallback(async () => {
    setAmSaving(true)
    try {
      await Promise.all([
        window.api.settings.set('agentManager.maxConcurrent', amSettings.maxConcurrent),
        window.api.settings.set('agentManager.worktreeBase', amSettings.worktreeBase),
        window.api.settings.set('agentManager.maxRuntimeMinutes', amSettings.maxRuntimeMinutes),
      ])
      setAmDirty(false)
      toast.success('Agent manager settings saved')
    } catch {
      toast.error('Failed to save agent manager settings')
    } finally {
      setAmSaving(false)
    }
  }, [amSettings])

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
    await window.api.settings.set('github.token', ghToken)
    setHasExistingGhToken(true)
    setGhToken('')
    setGhDirty(false)
    toast.success('GitHub token saved')
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

  // --- Derive auth badge ---
  let authBadgeVariant: 'success' | 'warning' | 'danger' = 'danger'
  let authBadgeLabel = 'Not Configured'
  if (authStatus) {
    if (authStatus.tokenFound && !authStatus.tokenExpired) {
      authBadgeVariant = 'success'
      authBadgeLabel = 'Connected'
    } else if (authStatus.tokenFound && authStatus.tokenExpired) {
      authBadgeVariant = 'warning'
      authBadgeLabel = 'Token Expired'
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Connections</h2>

      {/* Auth Status */}
      <div className="settings-connection">
        <span className="settings-connection__label">Claude CLI Auth</span>

        <div className="settings-field__row" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="settings-field__status">
            <Badge variant={authBadgeVariant} size="sm">{authBadgeLabel}</Badge>
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
      </div>

      {/* Agent Manager Settings */}
      <div className="settings-connection" style={{ marginTop: 8 }}>
        <span className="settings-connection__label">Agent Manager</span>

        <label className="settings-field">
          <span className="settings-field__label">Max Concurrent Agents</span>
          <input
            className="settings-field__input"
            type="number"
            min={1}
            max={10}
            value={amSettings.maxConcurrent}
            onChange={(e) => handleAmChange('maxConcurrent', e.target.value)}
          />
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Worktree Base Path</span>
          <input
            className="settings-field__input"
            type="text"
            value={amSettings.worktreeBase}
            onChange={(e) => handleAmChange('worktreeBase', e.target.value)}
            placeholder="/tmp/worktrees/bde"
          />
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Max Runtime (minutes)</span>
          <input
            className="settings-field__input"
            type="number"
            min={1}
            max={480}
            value={amSettings.maxRuntimeMinutes}
            onChange={(e) => handleAmChange('maxRuntimeMinutes', e.target.value)}
          />
        </label>

        <div className="settings-field__row">
          <div className="settings-field__status" />
          <div className="settings-field__actions">
            <Button
              variant="primary"
              size="sm"
              onClick={handleAmSave}
              disabled={!amDirty || amSaving}
              loading={amSaving}
              type="button"
            >
              {amSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* GitHub Token */}
      <CredentialForm
        title="GitHub"
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
    </section>
  )
}
