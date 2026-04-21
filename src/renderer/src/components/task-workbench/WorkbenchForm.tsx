import { useState, useCallback, useRef, useEffect } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useTaskWorkbenchValidation } from '../../stores/taskWorkbenchValidation'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useShallow } from 'zustand/react/shallow'
import { useValidationChecks } from '../../hooks/useValidationChecks'
import { useTaskFormState } from '../../hooks/useTaskFormState'
import { useSpecQualityChecks } from '../../hooks/useSpecQualityChecks'
import { useTaskCreation } from '../../hooks/useTaskCreation'
import { SpecEditor } from './SpecEditor'
import { ValidationChecks } from './ValidationChecks'
import { WorkbenchActions } from './WorkbenchActions'
import { DependencyPicker } from './DependencyPicker'
import { FormField } from './FormField'
import './WorkbenchForm.css'
import { ConfirmModal } from '../ui/ConfirmModal'
import { GlassPanel } from '../neon/GlassPanel'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { toast } from '../../stores/toasts'

const PRIORITY_OPTIONS = [
  { label: 'P1 Critical', value: 1 },
  { label: 'P2 High', value: 2 },
  { label: 'P3 Medium', value: 3 },
  { label: 'P4 Low', value: 4 },
  { label: 'P5 Backlog', value: 5 }
] as const

const MIN_SPEC_LENGTH_FOR_QUEUE = 50

interface QueueBlockerSnapshot {
  repo: string
  spec: string
  structuralChecks: { status: string; label: string }[]
  operationalChecks: { status: string; label: string }[]
}

/**
 * Returns a human-readable reason the queue action is blocked, or `null` if
 * it's safe to queue. Used by the Cmd+Enter handler to surface a toast when
 * the shortcut would otherwise be a silent no-op.
 */
function describeQueueBlocker(state: QueueBlockerSnapshot): string | null {
  if (!state.repo) return 'select a repo'
  if (state.spec.trim().length < MIN_SPEC_LENGTH_FOR_QUEUE) {
    return `spec is too short (needs ${MIN_SPEC_LENGTH_FOR_QUEUE}+ characters)`
  }
  const structuralFail = state.structuralChecks.find((c) => c.status === 'fail')
  if (structuralFail) return `${structuralFail.label} check failed`
  const operationalFail = state.operationalChecks.find((c) => c.status === 'fail')
  if (operationalFail) return `${operationalFail.label} check failed`
  return null
}

interface WorkbenchFormProps {
  onSendCopilotMessage: (message: string) => void
}

export function WorkbenchForm({ onSendCopilotMessage }: WorkbenchFormProps): React.JSX.Element {
  const form = useTaskFormState()
  const {
    title,
    repo,
    priority,
    advancedOpen,
    mode,
    taskId,
    spec,
    specType,
    dependsOn,
    playgroundEnabled,
    maxCostUsd,
    model,
    pendingGroupId,
    crossRepoContract,
    setField,
    resetForm
  } = form

  const repoOptions = useRepoOptions()

  // Scoped to only the fields DependencyPicker needs; avoids re-render on unrelated task changes.
  const allTasks = useSprintTasks(useShallow((s) => s.tasks))
  const structuralChecks = useTaskWorkbenchValidation((s) => s.structuralChecks)
  const operationalChecks = useTaskWorkbenchValidation((s) => s.operationalChecks)

  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showQueueConfirm, setShowQueueConfirm] = useState(false)
  const [queueConfirmMessage, setQueueConfirmMessage] = useState('')
  const [contractExpanded, setContractExpanded] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useValidationChecks()
  useSpecQualityChecks({ spec, title, repo, specType })

  const { save, saveConfirmed } = useTaskCreation({
    mode,
    taskId,
    formData: {
      title,
      repo,
      priority,
      spec,
      specType,
      dependsOn,
      playgroundEnabled,
      maxCostUsd,
      model,
      pendingGroupId,
      crossRepoContract
    }
  })

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(
    async (action: 'backlog' | 'queue') => {
      setSubmitting(true)
      try {
        const result = await save(action === 'queue' ? 'queued' : 'backlog')
        if (result.outcome === 'blocked') {
          return
        }
        if (result.outcome === 'confirm') {
          setQueueConfirmMessage(
            result.confirmMessage ?? 'Some checks have warnings. Queue anyway?'
          )
          setShowQueueConfirm(true)
          return
        }
        // outcome === 'ok'
        resetForm()
        toast.success(mode === 'edit' && taskId ? 'Task updated' : 'Task created')
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        toast.error(`Failed to ${action === 'queue' ? 'queue' : 'save'} task: ${message}`)
      } finally {
        setSubmitting(false)
      }
    },
    [save, resetForm, mode, taskId]
  )

  const handleConfirmedQueue = useCallback(async () => {
    setShowQueueConfirm(false)
    setSubmitting(true)
    try {
      await saveConfirmed('queued')
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }, [saveConfirmed, resetForm])

  const handleGenerate = useCallback(async () => {
    if (!title.trim()) {
      toast.error('Enter a title first')
      return
    }
    setGenerating(true)
    try {
      const result = await window.api.workbench.generateSpec({
        title,
        repo,
        templateHint: 'feature'
      })
      if (result.spec) setField('spec', result.spec)
    } catch {
      toast.error('Failed to generate spec')
    } finally {
      setGenerating(false)
    }
  }, [title, repo, setField])

  const handleResearch = useCallback(() => {
    if (!title.trim()) {
      toast.error('Enter a title first')
      return
    }
    onSendCopilotMessage(`Research the ${repo} codebase for: ${title}`)
  }, [title, repo, onSendCopilotMessage])

  // Keyboard shortcuts: Cmd+Enter to submit (with feedback when blocked)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== 'Enter' || !e.metaKey) return
      e.preventDefault()

      if (submitting) return // ignore while a submit is in flight

      const reason = describeQueueBlocker({ repo, spec, structuralChecks, operationalChecks })

      if (reason === null) {
        handleSubmit('queue')
        return
      }

      // Surface why the shortcut was a no-op so users aren't left guessing.
      toast.error(`Can't queue: ${reason}`)
      useTaskWorkbenchStore.setState({ checksExpanded: true })
    },
    [submitting, handleSubmit, repo, spec, structuralChecks, operationalChecks]
  )

  return (
    <div className="wb-form" aria-label="Task creation form" onKeyDown={handleKeyDown}>
      <div className="wb-form__heading">
        {mode === 'edit' ? `Edit: ${title || 'Untitled'}` : 'New Task'}
      </div>

      <div className="wb-form__group">
        <FormField label="Title *" htmlFor="wb-form-title">
          <input
            id="wb-form-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder='e.g. "Add recipe search to Feast onboarding"'
            className="wb-form__input"
          />
        </FormField>
        <FormField label="Repo" htmlFor="wb-form-repo">
          <select
            id="wb-form-repo"
            value={repo}
            onChange={(e) => setField('repo', e.target.value)}
            className="wb-form__select bde-select"
          >
            <option value="" disabled>
              Select a repository...
            </option>
            {repoOptions.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="wb-form__field--row">
        <FormField
          label="Priority"
          htmlFor="wb-form-priority"
          className="wb-form__field wb-form__field--flex"
        >
          <select
            id="wb-form-priority"
            value={priority}
            onChange={(e) => setField('priority', Number(e.target.value))}
            className="wb-form__select bde-select"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <DependencyPicker
        dependencies={dependsOn ?? []}
        availableTasks={allTasks}
        onChange={(deps) => setField('dependsOn', deps)}
        currentTaskId={taskId ?? undefined}
      />

      <div>
        <button
          onClick={() => setField('advancedOpen', !advancedOpen)}
          className="wb-form__toggle"
          aria-expanded={advancedOpen}
          aria-controls="wb-form-advanced"
        >
          {advancedOpen ? '\u25be' : '\u25b8'} Advanced (cost, playground)
        </button>
        {advancedOpen && (
          <div id="wb-form-advanced">
            <GlassPanel accent="purple" blur="sm" className="wb-form__advanced">
              <FormField label="Max Cost (USD)" htmlFor="wb-form-max-cost">
                <input
                  id="wb-form-max-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={maxCostUsd ?? ''}
                  onChange={(e) =>
                    setField('maxCostUsd', e.target.value ? Number(e.target.value) : null)
                  }
                  placeholder="No limit"
                  className={`wb-form__input${maxCostUsd && maxCostUsd > 50 ? ' wb-form__input--invalid' : ''}`}
                  aria-invalid={maxCostUsd !== null && maxCostUsd !== undefined && maxCostUsd > 50}
                />
              </FormField>
              <div className="wb-form__checkbox-row">
                <input
                  type="checkbox"
                  id="playground-enabled-workbench"
                  checked={playgroundEnabled}
                  onChange={(e) => setField('playgroundEnabled', e.target.checked)}
                />
                <label
                  htmlFor="playground-enabled-workbench"
                  className="wb-form__checkbox-label"
                  title="Enable native HTML preview rendering for frontend work"
                >
                  Dev Playground
                </label>
              </div>
              <div className="wb-form__field" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  id="wb-form-contract-toggle"
                  onClick={() => setContractExpanded(!contractExpanded)}
                  className="wb-form__toggle"
                  style={{ marginBottom: '0.5rem' }}
                  aria-expanded={contractExpanded}
                  aria-controls="wb-form-contract"
                >
                  {contractExpanded ? '\u25be' : '\u25b8'} Cross-Repo Contract
                </button>
                {contractExpanded && (
                  <div>
                    <textarea
                      id="wb-form-contract"
                      aria-labelledby="wb-form-contract-toggle"
                      value={crossRepoContract ?? ''}
                      onChange={(e) => setField('crossRepoContract', e.target.value)}
                      placeholder="e.g. SprintTask type definition, API endpoint contracts, shared types..."
                      className="wb-form__textarea wb-form__textarea--code"
                      rows={8}
                    />
                    <div
                      style={{
                        fontSize: '0.85em',
                        color: 'var(--bde-text-muted)',
                        marginTop: '0.25rem'
                      }}
                    >
                      Document API contracts, shared types, or cross-repo dependencies. Will be
                      injected into the agent prompt.
                    </div>
                  </div>
                )}
              </div>
            </GlassPanel>
          </div>
        )}
      </div>

      <FormField label="Spec" htmlFor="wb-form-spec">
        <SpecEditor
          onRequestGenerate={handleGenerate}
          onRequestResearch={handleResearch}
          generating={generating}
        />
      </FormField>

      <ValidationChecks />
      <WorkbenchActions
        onSaveBacklog={() => handleSubmit('backlog')}
        onQueueNow={() => handleSubmit('queue')}
        onCancel={mode === 'edit' ? resetForm : undefined}
        submitting={submitting}
      />

      <ConfirmModal
        open={showQueueConfirm}
        title="Queue with warnings?"
        message={queueConfirmMessage || 'Some checks have warnings. Queue anyway?'}
        confirmLabel="Queue Anyway"
        onConfirm={handleConfirmedQueue}
        onCancel={() => setShowQueueConfirm(false)}
      />
    </div>
  )
}
