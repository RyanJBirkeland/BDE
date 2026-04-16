import { useCallback, useEffect, useState } from 'react'
import { Check, X, AlertCircle, RefreshCw, ArrowRight, Terminal } from 'lucide-react'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'

interface OnboardingProps {
  onReady: () => void
}

interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: string
}

type CheckState = 'loading' | 'pass' | 'fail' | 'warn'

interface ExtendedCheckState {
  gitAvailable: CheckState
  reposConfigured: CheckState
}

function getCheckState(
  status: AuthStatus | null,
  field: keyof Pick<AuthStatus, 'cliFound' | 'tokenFound'>
): CheckState {
  if (!status) return 'loading'
  return status[field] ? 'pass' : 'fail'
}

function getExpiryState(status: AuthStatus | null): CheckState {
  if (!status) return 'loading'
  if (!status.tokenFound) return 'fail'
  return status.tokenExpired ? 'fail' : 'pass'
}

function StatusIcon({ state }: { state: CheckState }): React.JSX.Element {
  switch (state) {
    case 'loading':
      return <Spinner size="sm" />
    case 'pass':
      return <Check size={16} className="onboarding-icon--success" />
    case 'fail':
      return <X size={16} className="onboarding-icon--danger" />
    case 'warn':
      return <AlertCircle size={16} className="onboarding-icon--warning" />
  }
}

function getInstruction(status: AuthStatus | null): string | null {
  if (!status) return null
  if (!status.cliFound) return 'Install Claude Code CLI and add it to your PATH'
  if (!status.tokenFound) return 'Run `claude login` in your terminal'
  if (status.tokenExpired) return 'Run `claude login` to refresh your session'
  return null
}

function CheckRow({
  state,
  label,
  helpText,
  optional = false
}: {
  state: CheckState
  label: string
  helpText?: string
  optional?: boolean
}): React.JSX.Element {
  return (
    <div className="onboarding-check" style={{ gap: 'var(--bde-space-1)' }}>
      <div className="onboarding-check__row">
        <StatusIcon state={state} />
        <span className="onboarding-check__label">{label}</span>
        {optional && (
          <span
            className="onboarding-check__optional"
            style={{
              fontSize: 'var(--bde-size-xs)',
              marginLeft: 'var(--bde-space-1)'
            }}
          >
            (optional)
          </span>
        )}
      </div>
      {helpText && state === 'fail' && (
        <p
          className="onboarding-check__help onboarding-check__help--fail"
          style={{
            margin: `0 0 0 ${'var(--bde-space-6)'}`,
            fontSize: 'var(--bde-size-xs)'
          }}
        >
          {helpText}
        </p>
      )}
      {helpText && state === 'warn' && (
        <p
          className="onboarding-check__help onboarding-check__help--warn"
          style={{
            margin: `0 0 0 ${'var(--bde-space-6)'}`,
            fontSize: 'var(--bde-size-xs)'
          }}
        >
          {helpText}
        </p>
      )}
    </div>
  )
}

export function Onboarding({ onReady }: OnboardingProps): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [extended, setExtended] = useState<ExtendedCheckState>({
    gitAvailable: 'loading',
    reposConfigured: 'loading',
  })

  const runCheck = useCallback(async () => {
    setChecking(true)
    setExtended({
      gitAvailable: 'loading',
      reposConfigured: 'loading',
    })

    // Run auth check and extended checks concurrently
    const [authResult] = await Promise.allSettled([
      window.api.auth.status().then((result) => {
        setStatus(result)
        return result
      })
    ])

    // Git check — verify git CLI is installed by running git --version
    const gitCheck = window.api.git.checkInstalled().then(
      (ok) => (ok ? 'pass' : 'fail') as CheckState
    )

    // Repos configured check — look for 'repos' setting
    const reposCheck = window.api.settings.get('repos').then(
      (val) => (val ? 'pass' : 'warn') as CheckState,
      () => 'warn' as CheckState
    )

    const [git, repos] = await Promise.all([gitCheck, reposCheck])
    setExtended({ gitAvailable: git, reposConfigured: repos })

    setChecking(false)

    // Auto-advance only if all required checks pass (auth + git)
    if (authResult.status === 'fulfilled') {
      const res = authResult.value
      if (res.cliFound && res.tokenFound && !res.tokenExpired && git === 'pass') {
        onReady()
      }
    }
  }, [onReady])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runCheck()
  }, [runCheck])

  const cliState = getCheckState(status, 'cliFound')
  const tokenState = getCheckState(status, 'tokenFound')
  const expiryState = getExpiryState(status)
  const instruction = getInstruction(status)
  const allPassed =
    status?.cliFound &&
    status?.tokenFound &&
    !status?.tokenExpired &&
    extended.gitAvailable === 'pass'

  const requiredStates = [cliState, tokenState, expiryState, extended.gitAvailable]
  const anyRequiredFailed = requiredStates.some((s) => s === 'fail')

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <Terminal size={24} className="onboarding-header__icon" />
          <h2 className="onboarding-header__title">Setup Check</h2>
        </div>

        <p className="onboarding-subtitle">Verifying Claude Code CLI and environment</p>

        <div className="onboarding-checks" style={{ gap: 'var(--bde-space-3)' }}>
          <div className="onboarding-section-label">Required</div>
          <CheckRow
            state={cliState}
            label="Claude Code CLI installed"
            helpText="Install Claude Code CLI and add it to your PATH"
          />
          <CheckRow
            state={tokenState}
            label="Claude login completed"
            helpText="Run `claude login` in your terminal"
          />
          <CheckRow
            state={expiryState}
            label="Token not expired"
            helpText="Run `claude login` to refresh your session"
          />
          <CheckRow
            state={extended.gitAvailable}
            label="Git available"
            helpText="Install git and make sure it is on your PATH"
          />

          <div className="onboarding-section-label onboarding-section-label--spaced">Optional</div>
          <CheckRow
            state={extended.reposConfigured}
            label="Repositories configured"
            helpText="Add repos in Settings to enable agent task dispatch"
            optional
          />
        </div>

        {instruction && !checking && (
          <div className="onboarding-instruction">
            <code className="onboarding-instruction__code">{instruction}</code>
          </div>
        )}

        <div className="onboarding-actions">
          {!allPassed && (
            <Button variant="ghost" onClick={runCheck} loading={checking} disabled={checking}>
              <RefreshCw size={14} />
              Check Again
            </Button>
          )}
          {allPassed ? (
            <Button variant="primary" onClick={onReady}>
              <ArrowRight size={14} />
              Continue
            </Button>
          ) : (
            <Button variant="ghost" onClick={onReady} disabled={checking || anyRequiredFailed}>
              Continue Anyway
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
