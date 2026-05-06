import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SprintTask } from '../../../../shared/types'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { formatElapsed } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useNow } from '../../hooks/useNow'
import { useGitHubStatus } from '../../hooks/useGitHubStatus'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { TextareaPromptModal, useTextareaPrompt } from '../ui/TextareaPromptModal'
import { useTaskCost } from '../../hooks/useTaskCost'
import { TaskDetailActionButtonsV2 } from './TaskDetailActionButtonsV2'
import { TaskDrawerHeader } from './TaskDrawerHeader'
import { TaskDrawerEvents } from './TaskDrawerEvents'
import { TaskDrawerFailureDiagnostics } from './TaskDrawerFailureDiagnostics'
import { TaskDrawerOperatorActions } from './TaskDrawerOperatorActions'
import {
  SpecSection,
  LiveRunSection,
  DependenciesSection,
  MetadataSection,
  BranchOnlySection
} from './TaskDrawerSections'

export interface TaskDetailDrawerV2Props {
  task: SprintTask
  onClose: () => void
  onLaunch: (task: SprintTask) => void
  onStop: (task: SprintTask) => void
  onDelete: (task: SprintTask) => void
  onViewLogs: (task: SprintTask) => void
  onOpenSpec: () => void
  onEdit: (task: SprintTask) => void
  onViewAgents: (agentId: string) => void
  onUnblock?: ((task: SprintTask) => void) | undefined
  onRetry?: ((task: SprintTask) => void) | undefined
  onReviewChanges?: ((task: SprintTask) => void) | undefined
  onExport?: ((task: SprintTask) => void) | undefined
}

export function TaskDetailDrawerV2({
  task,
  onClose,
  onLaunch,
  onStop,
  onDelete,
  onViewLogs,
  onOpenSpec,
  onEdit,
  onViewAgents,
  onUnblock,
  onRetry,
  onReviewChanges,
  onExport
}: TaskDetailDrawerV2Props): React.JSX.Element {
  const titleRef = useRef<HTMLParagraphElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleId = `task-detail-title-${task.id}`
  const { configured: ghConfigured } = useGitHubStatus()

  useEffect(() => { titleRef.current?.focus() }, [task.id])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  useFocusTrap(drawerRef, false)

  const safeStartedAt = task.started_at ?? new Date().toISOString()
  const isActive = task.status === 'active' && !!task.started_at
  const [elapsed, setElapsed] = useState(() => (isActive ? formatElapsed(safeStartedAt) : ''))
  useBackoffInterval(() => setElapsed(formatElapsed(safeStartedAt)), isActive ? 10_000 : null)

  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)
  const depTaskIds = useMemo(() => new Set((task.depends_on ?? []).map((d) => d.id)), [task.depends_on])
  const depTasks = useSprintTasks(
    useShallow((s) => s.tasks.filter((t) => depTaskIds.has(t.id)).map((t) => ({ id: t.id, title: t.title, status: t.status })))
  )

  const agentRunId = task.agent_run_id
  const allAgentEvents = useAgentEventsStore((s) => agentRunId !== null ? (s.events[agentRunId] ?? []) : [])
  const recentAgentErrors = useMemo(() => allAgentEvents.filter((e) => e.type === 'agent:error').slice(-3), [allAgentEvents])

  const { costUsd } = useTaskCost(task.agent_run_id)
  const now = useNow()
  const progressPct = !task.started_at || !task.max_runtime_ms ? 0
    : Math.min(100, Math.round(((now - new Date(task.started_at).getTime()) / task.max_runtime_ms) * 100))

  const { prompt: promptForReason, promptProps: reasonPromptProps } = useTextareaPrompt()
  const { confirm: confirmForceDone, confirmProps: forceDoneConfirmProps } = useConfirm()
  const { confirm: confirmForceRelease, confirmProps: forceReleaseConfirmProps } = useConfirm()
  const { confirm: confirmDelete, confirmProps: deleteConfirmProps } = useConfirm()
  const { markTaskFailed, forceTaskDone, releaseTask } = useSprintTaskActions()

  async function handleMarkFailed(): Promise<void> {
    const reason = await promptForReason({
      title: 'Mark task as failed?',
      message: 'Agent will stop retrying and downstream tasks will unblock as if the task had failed normally. Optionally provide a reason for the audit trail.',
      placeholder: 'Reason (optional) — e.g. "scope changed, dropping this task"',
      confirmLabel: 'Mark Failed'
    })
    if (reason === null) return
    await markTaskFailed(task.id, reason.trim() || undefined)
  }

  async function handleForceDone(): Promise<void> {
    const approved = await confirmForceDone({ title: 'Force mark task as done?', message: 'This will trigger dependency resolution as if the agent succeeded. Use only if you have manually shipped the work.', confirmLabel: 'Force Done', variant: 'danger' })
    if (!approved) return
    await forceTaskDone(task.id)
  }

  async function handleForceRelease(): Promise<void> {
    const approved = await confirmForceRelease({ title: 'Force-release this task?', message: 'The task will return to queued and the agent manager will pick it up again. Use this if the agent process died without releasing the claim.', confirmLabel: 'Force Release', variant: 'danger' })
    if (!approved) return
    await releaseTask(task.id)
  }

  async function handleDelete(): Promise<void> {
    const approved = await confirmDelete({ title: 'Delete task?', message: `"${task.title}" will be permanently removed.`, confirmLabel: 'Delete', variant: 'danger' })
    if (!approved) return
    onDelete(task)
  }

  return (
    <div ref={drawerRef} style={{ width: 340, flexShrink: 0, borderLeft: '1px solid var(--line)', background: 'var(--bg)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }} role="complementary" aria-labelledby={titleId} data-testid="task-detail-drawer">
      <TaskDrawerHeader task={task} titleRef={titleRef} titleId={titleId} onClose={onClose} />
      <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line)' }}>
        <TaskDetailActionButtonsV2 task={task} onLaunch={onLaunch} onStop={onStop} onDelete={handleDelete} onViewLogs={onViewLogs} onEdit={onEdit} onUnblock={onUnblock} onRetry={onRetry} onReviewChanges={onReviewChanges} onExport={onExport} />
      </div>
      <SpecSection task={task} onOpenSpec={onOpenSpec} />
      {(task.status === 'active' || (task.status === 'queued' && task.claimed_by)) && (
        <LiveRunSection task={task} elapsed={elapsed} progressPct={progressPct} costUsd={costUsd} />
      )}
      {(task.depends_on?.length ?? 0) > 0 && (
        <DependenciesSection task={task} depTasks={depTasks} onSelectTask={setSelectedTaskId} />
      )}
      <TaskDrawerEvents events={allAgentEvents} />
      <MetadataSection task={task} agentRunId={agentRunId} onViewAgents={onViewAgents} />
      <TaskDrawerFailureDiagnostics task={task} recentAgentErrors={recentAgentErrors} />
      {task.pr_status === 'branch_only' && <BranchOnlySection notes={task.notes} ghConfigured={ghConfigured} />}
      <TaskDrawerOperatorActions task={task} onMarkFailed={handleMarkFailed} onForceDone={handleForceDone} onForceRelease={handleForceRelease} />
      <TextareaPromptModal {...reasonPromptProps} />
      <ConfirmModal {...forceDoneConfirmProps} />
      <ConfirmModal {...forceReleaseConfirmProps} />
      <ConfirmModal {...deleteConfirmProps} />
    </div>
  )
}
