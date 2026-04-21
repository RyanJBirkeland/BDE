import { ArrowRight, ArrowLeft, Github, Check, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
import { copyToClipboard } from '../../../lib/copy-to-clipboard'

const GH_AUTH_LOGIN_COMMAND = 'gh auth login'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

export function GhStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [ghAvailable, setGhAvailable] = useState<boolean | null>(null)
  const [ghAuthenticated, setGhAuthenticated] = useState<boolean | null>(null)
  const [ghVersion, setGhVersion] = useState<string | undefined>(undefined)
  const [checking, setChecking] = useState(true)

  const checkGh = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await window.api.onboarding.checkGhCli()
      setGhAvailable(result.available)
      setGhAuthenticated(result.authenticated)
      setGhVersion(result.version)
    } catch {
      setGhAvailable(false)
      setGhAuthenticated(false)
    }
    setChecking(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkGh()
  }, [])

  const ready = ghAvailable && ghAuthenticated

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <Github size={48} />
      </div>

      <h1 className="onboarding-step__title">GitHub CLI</h1>

      <p className="onboarding-step__description">
        BDE uses the GitHub CLI to create pull requests and interact with GitHub repositories.
      </p>

      <div className="onboarding-step__checks">
        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">⏳</div>
          ) : ghAvailable ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>
            {ghAvailable && ghVersion
              ? `gh CLI is available (${ghVersion})`
              : 'gh CLI is available on PATH'}
          </span>
        </div>

        {ghAvailable && (
          <div className="onboarding-step__check">
            {checking ? (
              <div className="onboarding-step__check-icon">⏳</div>
            ) : ghAuthenticated ? (
              <Check size={20} className="onboarding-step__check-icon--success" />
            ) : (
              <X size={20} className="onboarding-step__check-icon--error" />
            )}
            <span>gh CLI authenticated</span>
          </div>
        )}
      </div>

      {!checking && !ghAvailable && (
        <div className="onboarding-step__help">
          <p>
            gh CLI is required for creating pull requests.{' '}
            <a href="https://cli.github.com" target="_blank" rel="noreferrer">
              Install from cli.github.com
            </a>
          </p>
        </div>
      )}

      {!checking && ghAvailable && !ghAuthenticated && (
        <div className="onboarding-step__help">
          <p>Run this in your terminal to authenticate with GitHub:</p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--bde-space-2)',
              marginTop: 'var(--bde-space-2)'
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
              {GH_AUTH_LOGIN_COMMAND}
            </code>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard(GH_AUTH_LOGIN_COMMAND)}
              aria-label="Copy command to clipboard"
            >
              <Copy size={14} />
              Copy
            </Button>
          </div>
        </div>
      )}

      {!checking && (
        <Button variant="ghost" onClick={checkGh}>
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
        {!ready && !checking && (
          <Button
            variant="ghost"
            onClick={async () => {
              await window.api.settings.set('githubOptedOut', 'true')
              onNext()
            }}
          >
            Skip — read-only mode
          </Button>
        )}
        <Button
          variant="primary"
          onClick={async () => {
            await window.api.settings.set('githubOptedOut', 'false')
            onNext()
          }}
          disabled={checking || !ready}
        >
          Next
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
