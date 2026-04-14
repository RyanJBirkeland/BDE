import { ArrowRight, ArrowLeft, Terminal, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'

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

export function AuthStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [checking, setChecking] = useState(true)

  const checkAuth = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await window.api.auth.status()
      setStatus(result)
    } catch {
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
            <div className="onboarding-step__check-icon">⏳</div>
          ) : status?.cliFound ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>Claude Code CLI installed</span>
        </div>

        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">⏳</div>
          ) : status?.tokenFound ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>Authentication token found</span>
        </div>

        <div className="onboarding-step__check">
          {checking ? (
            <div className="onboarding-step__check-icon">⏳</div>
          ) : status?.tokenFound && !status?.tokenExpired ? (
            <Check size={20} className="onboarding-step__check-icon--success" />
          ) : (
            <X size={20} className="onboarding-step__check-icon--error" />
          )}
          <span>Token is valid</span>
        </div>
      </div>

      {!checking && !isReady && (
        <div className="onboarding-step__help">
          <code>claude login</code>
          <p>Run this command in your terminal to authenticate</p>
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
        <Button variant="primary" onClick={onNext}>
          Next
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  )
}
