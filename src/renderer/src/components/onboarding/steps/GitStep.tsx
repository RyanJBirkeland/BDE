import { ArrowRight, ArrowLeft, GitBranch, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

export function GitStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)

  const checkGit = async (): Promise<void> => {
    setChecking(true)
    const installed = await window.api.git.checkInstalled()
    setGitAvailable(installed)
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
            <div className="onboarding-step__check-icon">⏳</div>
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
          <p>Install git and ensure it&apos;s in your system PATH</p>
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
