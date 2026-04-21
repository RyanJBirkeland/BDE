import { useState } from 'react'
import { WelcomeStep } from './steps/WelcomeStep'
import { AuthStep } from './steps/AuthStep'
import { GitStep } from './steps/GitStep'
import { GhStep } from './steps/GhStep'
import { RepoStep } from './steps/RepoStep'
import { DoneStep } from './steps/DoneStep'
import '../../assets/onboarding.css'

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.JSX.Element | null {
  const [currentStep, setCurrentStep] = useState(0)

  const steps = [
    { component: WelcomeStep, title: 'Welcome' },
    { component: AuthStep, title: 'Authentication' },
    { component: GitStep, title: 'Git Setup' },
    { component: GhStep, title: 'GitHub CLI' },
    { component: RepoStep, title: 'Repositories' },
    { component: DoneStep, title: 'Ready' }
  ]

  const handleNext = (): void => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = (): void => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleComplete = (): void => {
    onComplete()
  }

  const currentStepData = steps[currentStep]
  if (!currentStepData) return null
  const StepComponent = currentStepData.component

  return (
    <div
      className="onboarding-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="BDE setup wizard"
    >
      <div className="onboarding-wizard">
        <ol
          className="onboarding-wizard__progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={currentStep + 1}
          aria-valuetext={`Step ${currentStep + 1} of ${steps.length}: ${currentStepData.title}`}
        >
          {steps.map((step, index) => (
            <li
              key={index}
              className={`onboarding-wizard__step-indicator ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              data-testid={`step-indicator-${index}`}
              aria-current={index === currentStep ? 'step' : undefined}
              aria-label={`Step ${index + 1} of ${steps.length}: ${step.title}${index < currentStep ? ' (completed)' : ''}`}
            >
              <div className="onboarding-wizard__step-number" aria-hidden="true">
                {index + 1}
              </div>
              <div className="onboarding-wizard__step-title">{step.title}</div>
            </li>
          ))}
        </ol>

        <div className="onboarding-wizard__content">
          <StepComponent
            onNext={handleNext}
            onBack={handleBack}
            onComplete={handleComplete}
            isFirst={currentStep === 0}
            isLast={currentStep === steps.length - 1}
          />
        </div>
      </div>
    </div>
  )
}
