import { ArrowLeft, CheckCircle, Rocket, Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../ui/Button'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { usePanelLayoutStore } from '../../../stores/panelLayout'
import { useRepoOptions } from '../../../hooks/useRepoOptions'
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
  const repoOptions = useRepoOptions()
  const [repoOverride, setRepoOverride] = useState<string | null>(null)
  const selectedRepoLabel = repoOverride ?? repoOptions[0]?.label ?? ''

  const handleCreateFirstTask = (): void => {
    setField('title', SAMPLE_FIRST_TASK.title)
    setField('spec', SAMPLE_FIRST_TASK.spec)
    setField('repo', selectedRepoLabel)
    setSpecType(SAMPLE_FIRST_TASK.specType)
    window.api.settings.set('onboarding.completed', 'true').catch((err) => {
      console.error('Failed to mark onboarding as completed:', err)
    })
    onComplete()
    setTimeout(() => setView('planner'), 0)
  }

  const handleOpenRepoSettings = (): void => {
    window.api.settings.set('onboarding.completed', 'true').catch((err) => {
      console.error('Failed to mark onboarding as completed:', err)
    })
    onComplete()
    setTimeout(() => setView('settings'), 0)
  }

  const hasRepos = repoOptions.length > 0

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

      {hasRepos && repoOptions.length > 1 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--bde-space-1)',
            marginTop: 'var(--bde-space-3)'
          }}
        >
          <label
            htmlFor="onboarding-done-repo-select"
            style={{ fontSize: 'var(--bde-size-xs)', color: 'var(--bde-text-muted)' }}
          >
            Start in repository
          </label>
          <select
            className="bde-select"
            id="onboarding-done-repo-select"
            value={selectedRepoLabel}
            onChange={(e) => setRepoOverride(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid var(--bde-border)',
              background: 'var(--bde-surface)'
            }}
          >
            {repoOptions.map((opt) => (
              <option key={opt.label} value={opt.label}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="onboarding-step__actions">
        {!isFirst && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
        )}
        {hasRepos ? (
          <>
            <Button variant="ghost" onClick={onComplete}>
              Get Started
            </Button>
            <Button variant="primary" onClick={handleCreateFirstTask}>
              <Rocket size={16} />
              Create your first task
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onComplete}>
              Explore BDE
            </Button>
            <Button variant="primary" onClick={handleOpenRepoSettings}>
              <SettingsIcon size={16} />
              Add a repository
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
