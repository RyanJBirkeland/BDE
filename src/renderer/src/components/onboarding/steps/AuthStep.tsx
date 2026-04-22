import { ArrowRight, ArrowLeft, Terminal, Check, X, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
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
const CLAUDE_INSTALL_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code'
const CLAUDE_INSTALL_COMMAND_CURL = 'curl -fsSL https://claude.ai/install.sh | bash'
const CLAUDE_INSTALL_COMMAND_NPM = 'npm i -g @anthropic-ai/claude-code'
const CLAUDE_INSTALL_COMMAND_BREW = 'brew install anthropic/claude/claude-code'
const CLAUDE_LOGIN_COMMAND = 'claude login'

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

  const isReady = status?.cliFound && status?.tokenFound && !status?.tokenExpired

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <Terminal size={48} />
      </div>

      <h1 className="onboarding-step__title">Claude Authentication</h1>

      <p className="onboarding-step__description">
        BDE requires Claude Code CLI for agent execution. Let&apos;s verify your setup.
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div
              className="onboarding-step__check-icon"
              role="status"
              aria-label="Checking Claude Code CLI"
            >
              ⏳
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
              ⏳
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
              ⏳
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
            Authentication check timed out. The Claude CLI may be slow to respond or blocked by a
            firewall. Resolve the issue, then click &quot;Check Again&quot; to continue.
          </p>
        </div>
      )}

      {!checking && !isReady && !status?.cliFound && (
        <div className="onboarding-step__help">
          <p>Install Claude Code CLI (choose one):</p>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--bde-space-2)',
              marginTop: 'var(--bde-space-2)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-2)' }}>
              <code
                style={{
                  flex: 1,
                  padding: '4px 10px',
                  background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: 'var(--bde-size-sm)',
                  overflow: 'auto'
                }}
              >
                {CLAUDE_INSTALL_COMMAND_CURL}
              </code>
              <Button
                variant="ghost"
                onClick={() => copyToClipboard(CLAUDE_INSTALL_COMMAND_CURL)}
                aria-label="Copy curl install command"
              >
                <Copy size={14} />
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-2)' }}>
              <code
                style={{
                  flex: 1,
                  padding: '4px 10px',
                  background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: 'var(--bde-size-sm)',
                  overflow: 'auto'
                }}
              >
                {CLAUDE_INSTALL_COMMAND_NPM}
              </code>
              <Button
                variant="ghost"
                onClick={() => copyToClipboard(CLAUDE_INSTALL_COMMAND_NPM)}
                aria-label="Copy npm install command"
              >
                <Copy size={14} />
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-2)' }}>
              <code
                style={{
                  flex: 1,
                  padding: '4px 10px',
                  background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: 'var(--bde-size-sm)',
                  overflow: 'auto'
                }}
              >
                {CLAUDE_INSTALL_COMMAND_BREW}
              </code>
              <Button
                variant="ghost"
                onClick={() => copyToClipboard(CLAUDE_INSTALL_COMMAND_BREW)}
                aria-label="Copy brew install command"
              >
                <Copy size={14} />
              </Button>
            </div>
          </div>
          <p style={{ marginTop: 'var(--bde-space-2)' }}>
            <Button
              variant="ghost"
              onClick={() => window.api.window.openExternal(CLAUDE_INSTALL_DOCS_URL)}
              style={{ padding: 0, height: 'auto', minHeight: 'auto' }}
            >
              Full install docs <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </Button>
          </p>
        </div>
      )}

      {!checking && !isReady && status?.cliFound && (
        <div className="onboarding-step__help">
          <p>Run this command in your terminal to authenticate:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-2)' }}>
            <code
              style={{
                padding: '4px 10px',
                background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: 'var(--bde-size-sm)'
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
        </div>
      )}

      {!checking && (
        <Button variant="ghost" onClick={checkAuth}>
          Check Again
        </Button>
      )}

      <div className="onboarding-step__actions">
        {!isFirst && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
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
