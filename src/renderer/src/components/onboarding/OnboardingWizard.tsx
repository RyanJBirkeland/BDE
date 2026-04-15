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

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.JSX.Element {
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

  const StepComponent = steps[currentStep].component

  return (
    <div className="onboarding-wizard-backdrop">
      <div className="onboarding-wizard">
        <div className="onboarding-wizard__progress">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`onboarding-wizard__step-indicator ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              data-testid={`step-indicator-${index}`}
            >
              <div className="onboarding-wizard__step-number">{index + 1}</div>
              <div className="onboarding-wizard__step-title">{step.title}</div>
            </div>
          ))}
        </div>

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
