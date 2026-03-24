import { useState, useCallback, useRef, useEffect } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useSprintTasks, type CreateTicketInput } from '../../stores/sprintTasks'
import { useReadinessChecks } from '../../hooks/useReadinessChecks'
import { SpecEditor } from './SpecEditor'
import { ReadinessChecks } from './ReadinessChecks'
import { WorkbenchActions } from './WorkbenchActions'
import { REPO_OPTIONS } from '../../lib/constants'
import { tokens } from '../../design-system/tokens'

const PRIORITY_OPTIONS = [
  { label: 'P1 Critical', value: 1 },
  { label: 'P2 High', value: 2 },
  { label: 'P3 Medium', value: 3 },
  { label: 'P4 Low', value: 4 },
  { label: 'P5 Backlog', value: 5 },
] as const

interface WorkbenchFormProps {
  onSendCopilotMessage: (message: string) => void
}

export function WorkbenchForm({ onSendCopilotMessage }: WorkbenchFormProps) {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const priority = useTaskWorkbenchStore((s) => s.priority)
  const advancedOpen = useTaskWorkbenchStore((s) => s.advancedOpen)
  const mode = useTaskWorkbenchStore((s) => s.mode)
  const taskId = useTaskWorkbenchStore((s) => s.taskId)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)
  const resetForm = useTaskWorkbenchStore((s) => s.resetForm)

  const createTask = useSprintTasks((s) => s.createTask)
  const updateTask = useSprintTasks((s) => s.updateTask)

  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useReadinessChecks()

  const setSemanticChecks = useTaskWorkbenchStore((s) => s.setSemanticChecks)
  const setOperationalChecks = useTaskWorkbenchStore((s) => s.setOperationalChecks)

  // Debounced semantic checks (Tier 2) — runs 2s after spec stops changing
  useEffect(() => {
    if (!spec.trim() || spec.length < 50) return

    useTaskWorkbenchStore.setState({ semanticLoading: true })

    const timer = setTimeout(async () => {
      try {
        const result = await window.api.workbench.checkSpec({ title, repo, spec })
        setSemanticChecks([
          { id: 'clarity', label: 'Clarity', tier: 2, status: result.clarity.status, message: result.clarity.message },
          { id: 'scope', label: 'Scope', tier: 2, status: result.scope.status, message: result.scope.message },
          { id: 'files-exist', label: 'Files', tier: 2, status: result.filesExist.status, message: result.filesExist.message },
        ])
      } catch {
        setSemanticChecks([
          { id: 'clarity', label: 'Clarity', tier: 2, status: 'warn', message: 'Unable to check' },
          { id: 'scope', label: 'Scope', tier: 2, status: 'warn', message: 'Unable to check' },
          { id: 'files-exist', label: 'Files', tier: 2, status: 'warn', message: 'Unable to check' },
        ])
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [spec, title, repo, setSemanticChecks])

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(async (action: 'backlog' | 'queue') => {
    setSubmitting(true)
    try {
      // Run operational checks for queue
      if (action === 'queue') {
        useTaskWorkbenchStore.setState({ operationalLoading: true })
        const opResult = await window.api.workbench.checkOperational({ repo })
        const opChecks = [
          { id: 'auth', label: 'Auth', tier: 3 as const, status: opResult.auth.status, message: opResult.auth.message },
          { id: 'repo-path', label: 'Repo Path', tier: 3 as const, status: opResult.repoPath.status, message: opResult.repoPath.message },
          { id: 'git-clean', label: 'Git Clean', tier: 3 as const, status: opResult.gitClean.status, message: opResult.gitClean.message },
          { id: 'no-conflict', label: 'No Conflict', tier: 3 as const, status: opResult.noConflict.status, message: opResult.noConflict.message },
          { id: 'slots', label: 'Agent Slots', tier: 3 as const, status: opResult.slotsAvailable.status, message: opResult.slotsAvailable.message },
        ]
        setOperationalChecks(opChecks)

        // Block if any operational check fails
        if (opChecks.some((c) => c.status === 'fail')) {
          useTaskWorkbenchStore.setState({ checksExpanded: true })
          setSubmitting(false)
          return
        }
      }

      // Proceed with create/update
      if (mode === 'edit' && taskId) {
        await updateTask(taskId, {
          title, repo, priority, spec,
          status: action === 'queue' ? 'queued' : 'backlog',
        })
      } else {
        const input: CreateTicketInput = {
          title, repo, prompt: title, spec, priority,
        }
        await createTask(input)
        // createTask hardcodes status=backlog. If queuing, find and update.
        if (action === 'queue') {
          const tasks = useSprintTasks.getState().tasks
          const created = tasks.find((t) => t.title === title && t.status === 'backlog')
          if (created) await updateTask(created.id, { status: 'queued' })
        }
      }
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }, [mode, taskId, title, repo, priority, spec, createTask, updateTask, resetForm, setOperationalChecks])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    try {
      const result = await window.api.workbench.generateSpec({ title, repo, templateHint: 'feature' })
      if (result.spec) setField('spec', result.spec)
    } finally {
      setGenerating(false)
    }
  }, [title, repo, setField])

  const handleResearch = useCallback(() => {
    if (!title.trim()) return
    onSendCopilotMessage(`Research the ${repo} codebase for: ${title}`)
  }, [title, repo, onSendCopilotMessage])

  const inputStyle = {
    padding: tokens.space[2], background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md,
    color: tokens.color.text, fontSize: tokens.size.md, outline: 'none', width: '100%',
  }

  const labelStyle = {
    fontSize: tokens.size.sm, fontWeight: 600 as const, color: tokens.color.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: tokens.space[4],
      padding: tokens.space[4], overflowY: 'auto', height: '100%',
    }}>
      <div style={{ fontSize: tokens.size.xl, fontWeight: 600, color: tokens.color.text }}>
        {mode === 'edit' ? `Edit: ${title || 'Untitled'}` : 'New Task'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[3] }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          <label style={labelStyle}>Title *</label>
          <input ref={titleRef} type="text" value={title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder='e.g. "Add recipe search to Feast onboarding"'
            style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          <label style={labelStyle}>Repo</label>
          <select value={repo} onChange={(e) => setField('repo', e.target.value)} style={inputStyle}>
            {REPO_OPTIONS.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <button onClick={() => setField('advancedOpen', !advancedOpen)} style={{
          background: 'none', border: 'none', color: tokens.color.textMuted,
          fontSize: tokens.size.sm, cursor: 'pointer', padding: 0,
        }}>
          {advancedOpen ? '\u25be' : '\u25b8'} More options
        </button>
        {advancedOpen && (
          <div style={{ marginTop: tokens.space[2], display: 'flex', gap: tokens.space[3] }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], flex: 1 }}>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={(e) => setField('priority', Number(e.target.value))} style={inputStyle}>
                {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
        <label style={labelStyle}>Spec</label>
        <SpecEditor onRequestGenerate={handleGenerate} onRequestResearch={handleResearch} generating={generating} />
      </div>

      <ReadinessChecks />
      <WorkbenchActions onSaveBacklog={() => handleSubmit('backlog')} onQueueNow={() => handleSubmit('queue')} submitting={submitting} />
    </div>
  )
}
