import { ArrowRight, ArrowLeft, Terminal, Check, X, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { Button } from '../../ui/Button'
import { Spinner } from '../../ui/Spinner'
import { copyToClipboard } from '../../../lib/copy-to-clipboard'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
}

const AUTH_CHECK_TIMEOUT_MS = 10_000
const VISIBILITY_CHECK_THROTTLE_MS = 2_000
const CLAUDE_INSTALL_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code'
const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'
const CLAUDE_LOGIN_COMMAND = 'claude login'
const CLAUDE_AUTH_STATUS_COMMAND = 'claude auth status'
const TROUBLESHOOTING_DOCS_URL = 'https://docs.claude.com/en/docs/troubleshooting'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Check timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export function AuthStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [timedOut, setTimedOut] = useState(false)
  const lastVisibilityCheckRef = useRef<number>(0)

  const checkAuth = async (): Promise<void> => {
    setChecking(true)
    setTimedOut(false)
    try {
      const result = await withTimeout(window.api.auth.status(), AUTH_CHECK_TIMEOUT_MS)
      setStatus(result)
    } catch (err) {
      if (err instanceof Error && err.message === 'Check timed out') {
        setTimedOut(true)
      }
      setStatus({ cliFound: false, tokenFound: false, tokenExpired: false })
    }
    setChecking(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkAuth()
  }, [])

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return

      const now = Date.now()
      const elapsed = now - lastVisibilityCheckRef.current
      if (elapsed < VISIBILITY_CHECK_THROTTLE_MS) return

      lastVisibilityCheckRef.current = now
      void checkAuth()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const isReady = status?.cliFound && status?.tokenFound && !status?.tokenExpired

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <Terminal size={48} />
      </div>

      <h1 className="onboarding-step__title">Claude Authentication</h1>

      <p className="onboarding-step__description">
        FLEET requires Claude Code CLI for agent execution. Let&apos;s verify your setup.
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div
              className="onboarding-step__check-icon"
              role="status"
              aria-label="Checking Claude Code CLI"
            >
              <Spinner size="sm" />
            </div>
          ) : status?.cliFound ? (
            <Check
              size={20}
              className="onboarding-step__check-icon--success"
              aria-label="Claude Code CLI installed"
            />
          ) : (
            <X
              size={20}
              className="onboarding-step__check-icon--error"
              aria-label="Claude Code CLI not found"
            />
          )}
          <span>Claude Code CLI installed</span>
        </div>

        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon" role="status" aria-label="Checking token">
              <Spinner size="sm" />
            </div>
          ) : status?.tokenFound ? (
            <Check
              size={20}
              className="onboarding-step__check-icon--success"
              aria-label="Token found"
            />
          ) : (
            <X
              size={20}
              className="onboarding-step__check-icon--error"
              aria-label="Token not found"
            />
          )}
          <span>Authentication token found</span>
        </div>

        <div className="onboarding-step__check">
          {checking ? (
            <div
              className="onboarding-step__check-icon"
              role="status"
              aria-label="Checking token validity"
            >
              <Spinner size="sm" />
            </div>
          ) : status?.tokenFound && !status?.tokenExpired ? (
            <Check
              size={20}
              className="onboarding-step__check-icon--success"
              aria-label="Token is valid"
            />
          ) : (
            <X
              size={20}
              className="onboarding-step__check-icon--error"
              aria-label="Token is missing or expired"
            />
          )}
          <span>Token is valid</span>
        </div>
      </div>

      {timedOut && (
        <div className="onboarding-step__help" role="alert">
          <p>
            <strong>Authentication check timed out.</strong> The Claude CLI may be slow to respond
            or blocked by a firewall.
          </p>
          <p style={{ marginTop: 'var(--fleet-space-2)' }}>Try these diagnostic steps:</p>
          <ol style={{ marginTop: 'var(--fleet-space-1)', paddingLeft: 'var(--fleet-space-4)' }}>
            <li style={{ marginBottom: 'var(--fleet-space-2)' }}>
              Run this command in Terminal to check CLI status:
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--fleet-space-2)',
                  marginTop: 'var(--fleet-space-1)'
                }}
              >
                <code
                  style={{
                    padding: '4px 10px',
                    background: 'var(--fleet-surface, rgba(0,0,0,0.08))',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: 'var(--fleet-size-sm)'
                  }}
                >
                  {CLAUDE_AUTH_STATUS_COMMAND}
                </code>
                <Button
                  variant="ghost"
                  onClick={() => copyToClipboard(CLAUDE_AUTH_STATUS_COMMAND)}
                  aria-label="Copy auth status command"
                >
                  <Copy size={14} />
                </Button>
              </div>
            </li>
            <li>
              If the CLI itself hangs, quit FLEET and relaunch it.
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--fleet-space-2)',
                  marginTop: 'var(--fleet-space-1)'
                }}
              >
                <code
                  style={{
                    padding: '4px 10px',
                    background: 'var(--fleet-surface, rgba(0,0,0,0.08))',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: 'var(--fleet-size-sm)'
                  }}
                >
                  ⌘Q then relaunch
                </code>
                <Button
                  variant="ghost"
                  onClick={() => copyToClipboard('⌘Q then relaunch')}
                  aria-label="Copy quit and relaunch instruction"
                >
                  <Copy size={14} />
                </Button>
              </div>
            </li>
            <li style={{ marginBottom: 'var(--fleet-space-2)' }}>
              On macOS, this can mean the system Keychain is locked. Try locking and unlocking your
              screen, then click &quot;Check Again&quot;.
            </li>
          </ol>
          <p style={{ marginTop: 'var(--fleet-space-2)' }}>
            <a href={TROUBLESHOOTING_DOCS_URL} target="_blank" rel="noreferrer">
              View full troubleshooting guide{' '}
              <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </a>
          </p>
        </div>
      )}

      {!checking && !isReady && !status?.cliFound && (
        <div className="onboarding-step__help">
          <p>Install Claude Code CLI:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--fleet-space-2)' }}>
            <code
              style={{
                padding: '4px 10px',
                background: 'var(--fleet-surface, rgba(0,0,0,0.08))',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: 'var(--fleet-size-sm)'
              }}
            >
              {CLAUDE_INSTALL_COMMAND}
            </code>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard(CLAUDE_INSTALL_COMMAND)}
              aria-label="Copy install command"
            >
              <Copy size={14} />
            </Button>
          </div>
          <p style={{ marginTop: 'var(--fleet-space-2)' }}>
            <a href={CLAUDE_INSTALL_DOCS_URL} target="_blank" rel="noreferrer">
              Full install docs <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </a>
          </p>
        </div>
      )}

      {!checking && !isReady && status?.cliFound && (
        <div className="onboarding-step__help">
          <p>Run this command in your terminal to authenticate:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--fleet-space-2)' }}>
            <code
              style={{
                padding: '4px 10px',
                background: 'var(--fleet-surface, rgba(0,0,0,0.08))',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: 'var(--fleet-size-sm)'
              }}
            >
              {CLAUDE_LOGIN_COMMAND}
            </code>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard(CLAUDE_LOGIN_COMMAND)}
              aria-label="Copy login command"
            >
              <Copy size={14} />
            </Button>
          </div>
          <p
            style={{
              marginTop: 'var(--fleet-space-2)',
              fontSize: 'var(--fleet-size-sm)',
              color: 'var(--fleet-text-muted)'
            }}
          >
            If you&apos;ve previously logged in and this is unexpected, your macOS Keychain may be
            locked — lock and unlock your screen, then click &quot;Check Again&quot;.
          </p>
        </div>
      )}

      {!checking && (
        <Button variant="ghost" onClick={checkAuth}>
          Check Again
        </Button>
      )}

      {!checking && !isReady && (
        <p
          className="onboarding-step__preflight-note"
          role="note"
        >
          <strong>Note:</strong> This is a preflight check only. Agents authenticate via the SDK
          at spawn time — if <code>claude</code> works in your terminal, agents will run normally.
          Common cause of red marks on unsigned bundles: macOS Keychain ACL.
        </p>
      )}

      <div className="onboarding-step__actions">
        {!isFirst && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
        )}
        {!checking && !isReady && (
          <Button variant="ghost" onClick={onNext}>
            Continue Anyway
          </Button>
        )}
        <Button variant="primary" onClick={onNext} disabled={checking || !isReady}>
          Next
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
