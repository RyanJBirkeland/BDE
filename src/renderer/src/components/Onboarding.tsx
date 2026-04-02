import { useCallback, useEffect, useState } from 'react'
import { Check, X, AlertCircle, RefreshCw, ArrowRight, Terminal } from 'lucide-react'
import { tokens } from '../design-system/tokens'
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
  supabaseConnected: CheckState
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
  return status.tokenExpired ? 'warn' : 'pass'
}

function StatusIcon({ state }: { state: CheckState }): React.JSX.Element {
  switch (state) {
    case 'loading':
      return <Spinner size="sm" />
    case 'pass':
      return <Check size={16} color={tokens.color.success} />
    case 'fail':
      return <X size={16} color={tokens.color.danger} />
    case 'warn':
      return <AlertCircle size={16} color={tokens.color.warning} />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
      <div style={styles.checkRow}>
        <StatusIcon state={state} />
        <span style={styles.checkLabel}>{label}</span>
        {optional && (
          <span
            style={{
              fontSize: tokens.size.xs,
              color: tokens.color.textMuted,
              marginLeft: tokens.space[1]
            }}
          >
            (optional)
          </span>
        )}
      </div>
      {helpText && state === 'fail' && (
        <p
          style={{
            margin: `0 0 0 ${tokens.space[6]}`,
            fontSize: tokens.size.xs,
            color: tokens.color.textMuted
          }}
        >
          {helpText}
        </p>
      )}
      {helpText && state === 'warn' && (
        <p
          style={{
            margin: `0 0 0 ${tokens.space[6]}`,
            fontSize: tokens.size.xs,
            color: tokens.color.warning
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
    supabaseConnected: 'loading'
  })

  const runCheck = useCallback(async () => {
    setChecking(true)
    setExtended({
      gitAvailable: 'loading',
      reposConfigured: 'loading',
      supabaseConnected: 'loading'
    })

    // Run auth check and extended checks concurrently
    const [authResult] = await Promise.allSettled([
      window.api.authStatus().then((result) => {
        setStatus(result)
        return result
      })
    ])

    // Git check — try to call getRepoPaths (requires git CLI)
    const gitCheck = window.api.getRepoPaths().then(
      () => 'pass' as CheckState,
      () => 'fail' as CheckState
    )

    // Repos configured check — look for 'repos' setting
    const reposCheck = window.api.settings.get('repos').then(
      (val) => (val ? 'pass' : 'warn') as CheckState,
      () => 'warn' as CheckState
    )

    // Supabase connected check — try a quick sprint list
    const supabaseCheck = window.api.sprint.list().then(
      () => 'pass' as CheckState,
      () => 'warn' as CheckState
    )

    const [git, repos, supabase] = await Promise.all([gitCheck, reposCheck, supabaseCheck])
    setExtended({ gitAvailable: git, reposConfigured: repos, supabaseConnected: supabase })

    setChecking(false)

    // Auto-advance only if required checks pass
    if (authResult.status === 'fulfilled') {
      const res = authResult.value
      if (res.cliFound && res.tokenFound && !res.tokenExpired) {
        onReady()
      }
    }
  }, [onReady])

  useEffect(() => {
    runCheck()
  }, [runCheck])

  const cliState = getCheckState(status, 'cliFound')
  const tokenState = getCheckState(status, 'tokenFound')
  const expiryState = getExpiryState(status)
  const instruction = getInstruction(status)
  const allPassed = status?.cliFound && status?.tokenFound && !status?.tokenExpired

  return (
    <div style={styles.backdrop}>
      <div style={styles.card}>
        <div style={styles.header}>
          <Terminal size={24} color={tokens.color.accent} />
          <h2 style={styles.title}>Setup Check</h2>
        </div>

        <p style={styles.subtitle}>Verifying Claude Code CLI and environment</p>

        <div style={styles.checks}>
          <div style={styles.sectionLabel}>Required</div>
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

          <div style={{ ...styles.sectionLabel, marginTop: tokens.space[3] }}>Optional</div>
          <CheckRow
            state={extended.reposConfigured}
            label="Repositories configured"
            helpText="Add repos in Settings to enable agent task dispatch"
            optional
          />
          <CheckRow
            state={extended.supabaseConnected}
            label="Supabase connected"
            helpText="Set supabase.url and supabase.serviceKey in Settings to enable Sprint tasks"
            optional
          />
        </div>

        {instruction && !checking && (
          <div style={styles.instruction}>
            <code style={styles.instructionCode}>{instruction}</code>
          </div>
        )}

        <div style={styles.actions}>
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
            <Button variant="ghost" onClick={onReady} disabled={checking}>
              Continue Anyway
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    background: tokens.color.bg,
    fontFamily: tokens.font.ui
  },
  card: {
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.xl,
    padding: tokens.space[8],
    maxWidth: '460px',
    width: '100%',
    boxShadow: tokens.shadow.lg
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[3],
    marginBottom: tokens.space[2]
  },
  title: {
    fontSize: tokens.size.xxl,
    fontWeight: 600,
    color: tokens.color.text,
    margin: 0
  },
  subtitle: {
    fontSize: tokens.size.md,
    color: tokens.color.textMuted,
    margin: `0 0 ${tokens.space[6]} 0`
  },
  checks: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space[3],
    marginBottom: tokens.space[6]
  },
  sectionLabel: {
    fontSize: tokens.size.xs,
    fontWeight: 600,
    color: tokens.color.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: tokens.space[1]
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[3]
  },
  checkLabel: {
    fontSize: tokens.size.md,
    color: tokens.color.text
  },
  instruction: {
    background: tokens.color.surfaceHigh,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    padding: `${tokens.space[3]} ${tokens.space[4]}`,
    marginBottom: tokens.space[6]
  },
  instructionCode: {
    fontSize: tokens.size.sm,
    color: tokens.color.warning,
    fontFamily: tokens.font.code
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: tokens.space[3]
  }
}
