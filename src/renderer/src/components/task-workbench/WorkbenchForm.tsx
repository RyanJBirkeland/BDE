import { useState, useCallback, useRef, useEffect } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useSprintTasks, type CreateTicketInput } from '../../stores/sprintTasks'
import { useReadinessChecks } from '../../hooks/useReadinessChecks'
import { SpecEditor } from './SpecEditor'
import { ReadinessChecks } from './ReadinessChecks'
import { WorkbenchActions } from './WorkbenchActions'
import { ConfirmModal } from '../ui/ConfirmModal'
import { REPO_OPTIONS } from '../../lib/constants'
import { toast } from '../../stores/toasts'

const PRIORITY_OPTIONS = [
  { label: 'P1 Critical', value: 1 },
  { label: 'P2 High', value: 2 },
  { label: 'P3 Medium', value: 3 },
  { label: 'P4 Low', value: 4 },
  { label: 'P5 Backlog', value: 5 }
] as const

interface WorkbenchFormProps {
  onSendCopilotMessage: (message: string) => void
}

export function WorkbenchForm({ onSendCopilotMessage }: WorkbenchFormProps): React.JSX.Element {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const priority = useTaskWorkbenchStore((s) => s.priority)
  const advancedOpen = useTaskWorkbenchStore((s) => s.advancedOpen)
  const mode = useTaskWorkbenchStore((s) => s.mode)
  const taskId = useTaskWorkbenchStore((s) => s.taskId)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const specType = useTaskWorkbenchStore((s) => s.specType)
  const dependsOn = useTaskWorkbenchStore((s) => s.dependsOn)
  const playgroundEnabled = useTaskWorkbenchStore((s) => s.playgroundEnabled)
  const setField = useTaskWorkbenchStore((s) => s.setField)
  const resetForm = useTaskWorkbenchStore((s) => s.resetForm)

  const createTask = useSprintTasks((s) => s.createTask)
  const updateTask = useSprintTasks((s) => s.updateTask)

  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showQueueConfirm, setShowQueueConfirm] = useState(false)
  const [queueConfirmMessage, setQueueConfirmMessage] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useReadinessChecks()

  const setSemanticChecks = useTaskWorkbenchStore((s) => s.setSemanticChecks)
  const setOperationalChecks = useTaskWorkbenchStore((s) => s.setOperationalChecks)

  // Shared helper to create or update a task with the given status
  const createOrUpdateTask = useCallback(
    async (targetStatus: 'backlog' | 'queued') => {
      const specType = useTaskWorkbenchStore.getState().specType
      if (mode === 'edit' && taskId) {
        await updateTask(taskId, {
          title,
          repo,
          priority,
          spec,
          depends_on: dependsOn.length > 0 ? dependsOn : null,
          playground_enabled: playgroundEnabled || undefined,
          status: targetStatus,
          spec_type: specType ?? undefined
        })
      } else {
        const input: CreateTicketInput = {
          title,
          repo,
          prompt: title,
          spec,
          priority,
          depends_on: dependsOn.length > 0 ? dependsOn : undefined,
          playground_enabled: playgroundEnabled || undefined,
          spec_type: specType ?? undefined
        }
        const createdId = await createTask(input)
        // createTask hardcodes status=backlog. If queuing, promote to queued.
        if (targetStatus === 'queued' && createdId) {
          await updateTask(createdId, { status: 'queued' })
        }
      }
    },
    [
      mode,
      taskId,
      title,
      repo,
      priority,
      spec,
      dependsOn,
      playgroundEnabled,
      createTask,
      updateTask
    ]
  )

  // Debounced semantic checks (Tier 2) — runs 2s after spec stops changing
  useEffect(() => {
    if (!spec.trim() || spec.length < 50) return

    useTaskWorkbenchStore.setState({ semanticLoading: true })

    const timer = setTimeout(async () => {
      try {
        const result = await window.api.workbench.checkSpec({ title, repo, spec, specType })
        setSemanticChecks([
          {
            id: 'clarity',
            label: 'Clarity',
            tier: 2,
            status: result.clarity.status,
            message: result.clarity.message
          },
          {
            id: 'scope',
            label: 'Scope',
            tier: 2,
            status: result.scope.status,
            message: result.scope.message
          },
          {
            id: 'files-exist',
            label: 'Files',
            tier: 2,
            status: result.filesExist.status,
            message: result.filesExist.message
          }
        ])
      } catch {
        setSemanticChecks([
          { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Unable to check' },
          { id: 'scope', label: 'Scope', tier: 2, status: 'warn', message: 'Unable to check' },
          { id: 'files-exist', label: 'Files', tier: 2, status: 'warn', message: 'Unable to check' }
        ])
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [spec, title, repo, specType, setSemanticChecks])

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(
    async (action: 'backlog' | 'queue') => {
      setSubmitting(true)
      try {
        // Run operational checks for queue
        if (action === 'queue') {
          useTaskWorkbenchStore.setState({ operationalLoading: true })
          const opResult = await window.api.workbench.checkOperational({ repo })
          const opChecks = [
            {
              id: 'auth',
              label: 'Auth',
              tier: 3 as const,
              status: opResult.auth.status,
              message: opResult.auth.message
            },
            {
              id: 'repo-path',
              label: 'Repo Path',
              tier: 3 as const,
              status: opResult.repoPath.status,
              message: opResult.repoPath.message
            },
            {
              id: 'git-clean',
              label: 'Git Clean',
              tier: 3 as const,
              status: opResult.gitClean.status,
              message: opResult.gitClean.message
            },
            {
              id: 'no-conflict',
              label: 'No Conflict',
              tier: 3 as const,
              status: opResult.noConflict.status,
              message: opResult.noConflict.message
            },
            {
              id: 'slots',
              label: 'Agent Slots',
              tier: 3 as const,
              status: opResult.slotsAvailable.status,
              message: opResult.slotsAvailable.message
            }
          ]
          setOperationalChecks(opChecks)

          // Block if any operational check fails
          if (opChecks.some((c) => c.status === 'fail')) {
            useTaskWorkbenchStore.setState({ checksExpanded: true })
            setSubmitting(false)
            return
          }

          // Collect ALL warnings: operational + advisory structural/semantic
          const allStructural = useTaskWorkbenchStore.getState().structuralChecks
          const allSemantic = useTaskWorkbenchStore.getState().semanticChecks
          const advisoryWarnings = [...allStructural, ...allSemantic].filter(
            (c) => c.status === 'warn'
          )
          const opWarnings = opChecks.filter((c) => c.status === 'warn')
          const allWarnings = [...advisoryWarnings, ...opWarnings]
          if (allWarnings.length > 0) {
            const lines = allWarnings.map((c) => `• ${c.label}: ${c.message}`)
            setQueueConfirmMessage(
              `The following checks have warnings:\n\n${lines.join('\n')}\n\nQueue anyway?`
            )
            useTaskWorkbenchStore.setState({ checksExpanded: true })
            setShowQueueConfirm(true)
            setSubmitting(false)
            return
          }
        }

        // Proceed with create/update
        await createOrUpdateTask(action === 'queue' ? 'queued' : 'backlog')
        resetForm()
        toast.success(mode === 'edit' && taskId ? 'Task updated' : 'Task created')
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        toast.error(`Failed to ${action === 'queue' ? 'queue' : 'save'} task: ${message}`)
      } finally {
        setSubmitting(false)
      }
    },
    [createOrUpdateTask, resetForm, setOperationalChecks, repo, mode, taskId]
  )

  const handleConfirmedQueue = useCallback(async () => {
    setShowQueueConfirm(false)
    setSubmitting(true)
    try {
      await createOrUpdateTask('queued')
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }, [createOrUpdateTask, resetForm])

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

  // Keyboard shortcuts: Cmd+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        const structural = useTaskWorkbenchStore.getState().structuralChecks
        const operational = useTaskWorkbenchStore.getState().operationalChecks
        const noTier1Fails = structural.every((c) => c.status !== 'fail')
        const tier3HasFails = operational.some((c) => c.status === 'fail')
        const canQueue = noTier1Fails && !tier3HasFails
        if (canQueue && !submitting) {
          handleSubmit('queue')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [submitting, handleSubmit])

  return (
    <div className="wb-form" aria-label="Task creation form">
      <div className="wb-form__heading">
        {mode === 'edit' ? `Edit: ${title || 'Untitled'}` : 'New Task'}
      </div>

      <div className="wb-form__group">
        <div className="wb-form__field">
          <label htmlFor="wb-form-title" className="wb-form__label">
            Title *
          </label>
          <input
            id="wb-form-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder='e.g. "Add recipe search to Feast onboarding"'
            className="wb-form__input"
          />
        </div>
        <div className="wb-form__field">
          <label htmlFor="wb-form-repo" className="wb-form__label">
            Repo
          </label>
          <select
            id="wb-form-repo"
            value={repo}
            onChange={(e) => setField('repo', e.target.value)}
            className="wb-form__select"
          >
            {REPO_OPTIONS.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <button onClick={() => setField('advancedOpen', !advancedOpen)} className="wb-form__toggle">
          {advancedOpen ? '\u25be' : '\u25b8'} More options
        </button>
        {advancedOpen && (
          <div className="wb-form__advanced">
            <div className="wb-form__field--row">
              <div className="wb-form__field wb-form__field--flex">
                <label htmlFor="wb-form-priority" className="wb-form__label">
                  Priority
                </label>
                <select
                  id="wb-form-priority"
                  value={priority}
                  onChange={(e) => setField('priority', Number(e.target.value))}
                  className="wb-form__select"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
          </div>
        )}
      </div>

      <div className="wb-form__field">
        <label htmlFor="wb-form-spec" className="wb-form__label">
          Spec
        </label>
        <SpecEditor
          onRequestGenerate={handleGenerate}
          onRequestResearch={handleResearch}
          generating={generating}
        />
      </div>

      <ReadinessChecks />
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
