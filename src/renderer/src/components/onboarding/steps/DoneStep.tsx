import { ArrowLeft, CheckCircle, Rocket } from 'lucide-react'
import { Button } from '../../ui/Button'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { usePanelLayoutStore } from '../../../stores/panelLayout'
import { SAMPLE_FIRST_TASK } from './sample-first-task'

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  isFirst: boolean
  isLast: boolean
}

export function DoneStep({ onBack, onComplete, isFirst }: StepProps): React.JSX.Element {
  const setField = useTaskWorkbenchStore((s) => s.setField)
  const setSpecType = useTaskWorkbenchStore((s) => s.setSpecType)
  const setView = usePanelLayoutStore((s) => s.setView)

  const handleCreateFirstTask = (): void => {
    setField('title', SAMPLE_FIRST_TASK.title)
    setField('spec', SAMPLE_FIRST_TASK.spec)
    setField('repo', SAMPLE_FIRST_TASK.repo)
    setSpecType(SAMPLE_FIRST_TASK.specType)
    window.api.settings.set('onboarding.completed', 'true').catch(() => {})
    onComplete()
    // Defer navigation so the wizard unmounts first
    setTimeout(() => setView('task-workbench'), 0)
  }

  return (
    <div className="onboarding-step">
      <div className="onboarding-step__icon">
        <CheckCircle size={48} />
      </div>

      <h1 className="onboarding-step__title">You&apos;re Ready!</h1>

      <p className="onboarding-step__description">
        Setup complete. You can now start creating sprint tasks, spawning agents, and automating
        your development workflow.
      </p>

      <div className="onboarding-step__features">
        <div className="onboarding-step__feature">
          <strong>Dashboard</strong>
          <span>View metrics and pipeline health (⌘1)</span>
        </div>
        <div className="onboarding-step__feature">
          <strong>Task Workbench</strong>
          <span>Create specs with AI copilot assistance</span>
        </div>
        <div className="onboarding-step__feature">
          <strong>Sprint Pipeline</strong>
          <span>Monitor agent execution in real-time (⌘4)</span>
        </div>
        <div className="onboarding-step__feature">
          <strong>Code Review</strong>
          <span>Review agent changes before merge (⌘5)</span>
        </div>
      </div>

      <div className="onboarding-step__actions">
        {!isFirst && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
        )}
        <Button variant="ghost" onClick={onComplete}>
          Get Started
        </Button>
        <Button variant="primary" onClick={handleCreateFirstTask}>
          <Rocket size={16} />
          Create your first task
        </Button>
      </div>
    </div>
  )
}
