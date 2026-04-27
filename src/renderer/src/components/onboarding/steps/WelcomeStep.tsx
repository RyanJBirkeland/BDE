import { ArrowRight, ArrowLeft, Zap } from 'lucide-react'
import { Button } from '../../ui/Button'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

export function WelcomeStep({ onNext, onBack, isFirst }: StepProps): React.JSX.Element {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <Zap size={48} />
      </div>

      <h1 className="onboarding-step__title">Welcome to FLEET</h1>

      <p className="onboarding-step__description">
        The Agentic Development Environment is your autonomous AI-powered development assistant.
        Let&apos;s get you set up in just a few steps.
      </p>

      <div className="onboarding-step__features">
        <div className="onboarding-step__feature">
          <strong>AI Agents</strong>
          <span>Autonomous code execution in isolated git worktrees</span>
        </div>
        <div className="onboarding-step__feature">
          <strong>Sprint Pipeline</strong>
          <span>Task orchestration from spec to PR</span>
        </div>
        <div className="onboarding-step__feature">
          <strong>Code Review</strong>
          <span>Human-in-the-loop review before merge</span>
        </div>
      </div>

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
