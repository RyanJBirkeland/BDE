import { ArrowRight, ArrowLeft, GitBranch, Check, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
import { Spinner } from '../../ui/Spinner'
import { copyToClipboard } from '../../../lib/copy-to-clipboard'

const GIT_CHECK_TIMEOUT_MS = 5_000

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

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

export function GitStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  const [timedOut, setTimedOut] = useState(false)

  const checkGit = async (): Promise<void> => {
    setChecking(true)
    setTimedOut(false)
    try {
      const installed = await withTimeout(window.api.git.checkInstalled(), GIT_CHECK_TIMEOUT_MS)
      setGitAvailable(installed)
    } catch (err) {
      if (err instanceof Error && err.message === 'Check timed out') {
        setTimedOut(true)
      }
      setGitAvailable(false)
    }
    setChecking(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkGit()
  }, [])

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <GitBranch size={48} />
      </div>

      <h1 className="onboarding-step__title">Git Setup</h1>

      <p className="onboarding-step__description">
        BDE agents work in isolated git worktrees. Make sure git is installed and accessible.
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">
              <Spinner size="sm" />
            </div>
          ) : gitAvailable ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>Git is available on PATH</span>
        </div>
      </div>

      {!checking && !gitAvailable && (
        <div className="onboarding-step__help">
          <p>Install git using one of these methods:</p>
          <p style={{ marginTop: 'var(--bde-space-2)', fontWeight: 600 }}>
            Option 1 — Xcode Command Line Tools (recommended):
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--bde-space-2)',
              marginTop: 'var(--bde-space-1)'
            }}
          >
            <code
              style={{
                padding: '4px 10px',
                background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: 'var(--bde-size-sm)'
              }}
            >
              xcode-select --install
            </code>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard('xcode-select --install')}
              aria-label="Copy xcode-select install command"
            >
              <Copy size={14} />
            </Button>
          </div>
          <p style={{ marginTop: 'var(--bde-space-2)', fontWeight: 600 }}>Option 2 — Homebrew:</p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--bde-space-2)',
              marginTop: 'var(--bde-space-1)'
            }}
          >
            <code
              style={{
                padding: '4px 10px',
                background: 'var(--bde-surface, rgba(0,0,0,0.08))',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: 'var(--bde-size-sm)'
              }}
            >
              brew install git
            </code>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard('brew install git')}
              aria-label="Copy brew install git command"
            >
              <Copy size={14} />
            </Button>
          </div>
          {timedOut && (
            <p
              style={{
                marginTop: 'var(--bde-space-2)',
                color: 'var(--bde-color-warning, orange)',
                fontSize: 'var(--bde-size-sm)'
              }}
            >
              Git check timed out — ensure git is installed and accessible on your PATH.
            </p>
          )}
        </div>
      )}

      {!checking && (
        <Button variant="ghost" onClick={checkGit}>
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
        <Button variant="primary" onClick={onNext} disabled={checking || !gitAvailable}>
          Next
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
