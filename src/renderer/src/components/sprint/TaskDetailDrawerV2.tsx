import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SprintTask } from '../../../../shared/types'
import { parseRevisionFeedback } from '../../../../shared/types/revision'
import type { RevisionFeedback } from '../../../../shared/types/revision'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { formatElapsed, failureCategoryForReason } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useNow } from '../../hooks/useNow'
import { useGitHubStatus } from '../../hooks/useGitHubStatus'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { TextareaPromptModal, useTextareaPrompt } from '../ui/TextareaPromptModal'
import { useTaskCost } from '../../hooks/useTaskCost'
import { DrawerSection } from './primitives/DrawerSection'
import { MiniStat } from './primitives/MiniStat'
import { PriorityChip } from './primitives/PriorityChip'
import { StatusDot } from '../ui/StatusDot'
import type { StatusDotKind } from '../ui/StatusDot'
import { statusToDotKind } from '../../lib/task-status'
import { Tag } from '../ui/Tag'
import { TaskDetailActionButtonsV2 } from './TaskDetailActionButtonsV2'

const textPretty = { textWrap: 'pretty' } as React.CSSProperties

const FORCE_FAIL_VISIBLE_STATUSES: ReadonlySet<SprintTask['status']> = new Set([
  'queued',
  'active',
  'blocked'
])

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

function statusTextColor(status: string): string {
  switch (status) {
    case 'active':
      return 'var(--st-running)'
    case 'blocked':
      return 'var(--st-blocked)'
    case 'review':
    case 'approved':
      return 'var(--st-review)'
    case 'done':
      return 'var(--st-done)'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'var(--st-failed)'
    default:
      return 'var(--fg-3)'
  }
}

function eventToKind(type: string): StatusDotKind {
  if (type === 'error') return 'failed'
  if (type === 'done' || type === 'success') return 'done'
  if (type === 'blocked') return 'blocked'
  return 'running'
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function renderFailureNotes(notes: string | null | undefined): React.JSX.Element {
  if (!notes) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
        No diagnostic notes captured. Check the Agents view for details.
      </span>
    )
  }
  const feedback = parseRevisionFeedback(notes)
  if (feedback) return <VerificationDiagnostics feedback={feedback} />
  return (
    <pre
      data-testid="task-drawer-failure-notes"
      style={{
        margin: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-2)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}
    >
      {notes}
    </pre>
  )
}

function VerificationDiagnostics({ feedback }: { feedback: RevisionFeedback }): React.JSX.Element {
  return (
    <div
      data-testid="task-drawer-verification-diagnostics"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}
    >
      <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>{feedback.summary}</p>
      {feedback.diagnostics.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: '0 0 0 var(--s-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-1)'
          }}
        >
          {feedback.diagnostics.map((d, i) => (
            <li key={i} style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                {d.file}
                {d.line !== undefined ? `:${d.line}` : ''} [{d.kind}]
              </span>{' '}
              {d.message}
              {d.suggestedFix && (
                <span style={{ color: 'var(--fg-3)' }}> — Fix: {d.suggestedFix}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
  const [elapsed, setElapsed] = useState(() =>
    task.status === 'active' && task.started_at ? formatElapsed(task.started_at) : ''
  )
  const { configured: ghConfigured } = useGitHubStatus()
  const titleRef = useRef<HTMLParagraphElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleId = `task-detail-title-${task.id}`

  useEffect(() => {
    titleRef.current?.focus()
  }, [task.id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useFocusTrap(drawerRef, true)

  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setElapsed(formatElapsed(task.started_at!)), isActive ? 10_000 : null)

  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)

  const depTaskIds = useMemo(
    () => new Set((task.depends_on ?? []).map((d) => d.id)),
    [task.depends_on]
  )
  const depTasks = useSprintTasks(
    useShallow((s) =>
      s.tasks
        .filter((t) => depTaskIds.has(t.id))
        .map((t) => ({ id: t.id, title: t.title, status: t.status }))
    )
  )

  const agentRunId = task.agent_run_id
  const allAgentEvents = useAgentEventsStore((s) =>
    agentRunId !== null ? (s.events[agentRunId] ?? []) : []
  )
  const recentEvents = allAgentEvents.slice(-8).reverse()

  const { costUsd } = useTaskCost(task.agent_run_id)
  const now = useNow()

  const progressPct =
    !task.started_at || !task.max_runtime_ms
      ? 0
      : Math.min(
          100,
          Math.round(((now - new Date(task.started_at).getTime()) / task.max_runtime_ms) * 100)
        )

  const { prompt: promptForReason, promptProps: reasonPromptProps } = useTextareaPrompt()
  const { confirm: confirmForceDone, confirmProps: forceDoneConfirmProps } = useConfirm()
  const { confirm: confirmForceRelease, confirmProps: forceReleaseConfirmProps } = useConfirm()
  const { confirm: confirmDelete, confirmProps: deleteConfirmProps } = useConfirm()

  const { markTaskFailed, forceTaskDone, releaseTask } = useSprintTaskActions()

  const showMarkFailed = FORCE_FAIL_VISIBLE_STATUSES.has(task.status)
  const showForceDone = task.status !== 'done'
  const showForceRelease = task.status === 'active' && !!task.claimed_by

  async function handleMarkFailed(): Promise<void> {
    const reason = await promptForReason({
      title: 'Mark task as failed?',
      message:
        'Agent will stop retrying and downstream tasks will unblock as if the task had failed normally. Optionally provide a reason for the audit trail.',
      placeholder: 'Reason (optional) — e.g. "scope changed, dropping this task"',
      confirmLabel: 'Mark Failed'
    })
    if (reason === null) return
    await markTaskFailed(task.id, reason.trim() || undefined)
  }

  async function handleForceDone(): Promise<void> {
    const approved = await confirmForceDone({
      title: 'Force mark task as done?',
      message:
        'This will trigger dependency resolution as if the agent succeeded. Use only if you have manually shipped the work.',
      confirmLabel: 'Force Done',
      variant: 'danger'
    })
    if (!approved) return
    await forceTaskDone(task.id)
  }

  async function handleForceRelease(): Promise<void> {
    const approved = await confirmForceRelease({
      title: 'Force-release this task?',
      message:
        'The task will return to queued and the agent manager will pick it up again. Use this if the agent process died without releasing the claim.',
      confirmLabel: 'Force Release',
      variant: 'danger'
    })
    if (!approved) return
    await releaseTask(task.id)
  }

  async function handleDelete(): Promise<void> {
    const approved = await confirmDelete({
      title: 'Delete task?',
      message: `"${task.title}" will be permanently removed.`,
      confirmLabel: 'Delete',
      variant: 'danger'
    })
    if (!approved) return
    onDelete(task)
  }

  const recentAgentErrors = useMemo(
    () => allAgentEvents.filter((e) => e.type === 'agent:error').slice(-3),
    [allAgentEvents]
  )

  return (
    <div
      ref={drawerRef}
      style={{
        width: 340,
        flexShrink: 0,
        borderLeft: '1px solid var(--line)',
        background: 'var(--bg)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}
      role="complementary"
      aria-labelledby={titleId}
      data-testid="task-detail-drawer"
    >
      {/* Sticky header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: 'var(--bg)',
          padding: 'var(--s-3) var(--s-4)',
          borderBottom: '1px solid var(--line)'
        }}
      >
        {/* Top meta row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-1)',
            minWidth: 0,
            marginBottom: 'var(--s-1)'
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
            {task.id.substring(0, 8)}
          </span>
          {task.priority != null && <PriorityChip priority={task.priority} />}
          {/* Status indicator — pulse ONLY for active */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'var(--s-1)' }}>
            {task.status === 'active' ? (
              <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
            ) : (
              <StatusDot kind={statusToDotKind(task.status, task.pr_status)} size={6} />
            )}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: statusTextColor(task.status)
              }}
            >
              {task.status}
            </span>
          </div>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close task details"
            style={{
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-3)',
              cursor: 'pointer',
              borderRadius: 'var(--r-sm)',
              fontSize: 14
            }}
          >
            ×
          </button>
        </div>

        {/* Title */}
        <p
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--fg)',
            lineHeight: 1.4,
            margin: '0 0 var(--s-1) 0',
            ...textPretty
          }}
        >
          {task.title}
        </p>

        {/* Tag row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-1)',
            flexWrap: 'wrap',
            minWidth: 0
          }}
        >
          {task.tags?.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-3)'
            }}
          >
            {task.repo}
          </span>
        </div>
      </div>

      {/* Action row */}
      <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line)' }}>
        <TaskDetailActionButtonsV2
          task={task}
          onLaunch={onLaunch}
          onStop={onStop}
          onDelete={handleDelete}
          onViewLogs={onViewLogs}
          onEdit={onEdit}
          onUnblock={onUnblock}
          onRetry={onRetry}
          onReviewChanges={onReviewChanges}
          onExport={onExport}
        />
      </div>

      {/* BRIEF · Spec */}
      <DrawerSection eyebrow="BRIEF" title="Spec">
        {task.spec ? (
          <>
            <p
              style={{
                fontSize: 12,
                color: 'var(--fg-2)',
                lineHeight: 1.5,
                margin: 0,
                ...textPretty
              }}
            >
              {task.spec.length > 300 ? task.spec.substring(0, 300) + '…' : task.spec}
            </p>
            <button
              onClick={onOpenSpec}
              style={{
                alignSelf: 'flex-start',
                height: 24,
                padding: '0 var(--s-2)',
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--fg-2)',
                cursor: 'pointer'
              }}
            >
              edit spec ↗
            </button>
          </>
        ) : (
          <div
            style={{
              border: '1px dashed var(--line)',
              borderRadius: 'var(--r-md)',
              padding: 'var(--s-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)'
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>
              No spec yet
            </span>
            <button
              onClick={onOpenSpec}
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--fg-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Generate
            </button>
          </div>
        )}
      </DrawerSection>

      {/* LIVE · Agent run — only when active or queued+claimed */}
      {(task.status === 'active' || (task.status === 'queued' && task.claimed_by)) && (
        <DrawerSection eyebrow="LIVE" title="Agent run">
          {/* Row 1: pulse · name · pct */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--fg)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {task.title}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--fg-2)',
                flexShrink: 0
              }}
            >
              {progressPct}%
            </span>
          </div>
          {/* Row 2: progress bar */}
          <div style={{ height: 2, background: 'var(--surf-3)', borderRadius: 1 }}>
            <div
              style={{ height: '100%', width: `${progressPct}%`, background: 'var(--st-running)' }}
            />
          </div>
          {/* Row 3: 3-up MiniStat grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s-1)' }}>
            <MiniStat label="ELAPSED" value={elapsed || '—'} />
            <MiniStat label="COST" value={costUsd != null ? `$${costUsd.toFixed(2)}` : '—'} />
            {/* TODO(phase-3.5): needs token count from events */}
            <MiniStat label="TOKENS" value="—" />
          </div>
        </DrawerSection>
      )}

      {/* GRAPH · Dependencies */}
      {(task.depends_on?.length ?? 0) > 0 && (
        <DrawerSection eyebrow="GRAPH" title="Dependencies">
          {(task.depends_on ?? []).map((dep) => {
            const depTask = depTasks.find((t) => t.id === dep.id)
            return (
              <button
                key={dep.id}
                onClick={() => setSelectedTaskId(dep.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  padding: '4px 0',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left'
                }}
              >
                <StatusDot kind={depTask ? statusToDotKind(depTask.status) : 'queued'} size={6} />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--fg-4)',
                    flexShrink: 0
                  }}
                >
                  {dep.id.substring(0, 8)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {depTask?.title ?? dep.id}
                </span>
              </button>
            )
          })}
        </DrawerSection>
      )}

      {/* TRACE · Activity */}
      <DrawerSection eyebrow="TRACE" title="Activity">
        {recentEvents.length === 0 ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
            No activity yet
          </span>
        ) : (
          recentEvents.map((event, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 10px 1fr',
                gap: 'var(--s-1)',
                alignItems: 'start',
                fontFamily: 'var(--font-mono)',
                fontSize: 10
              }}
            >
              <span style={{ color: 'var(--fg-4)' }}>
                {new Date(event.timestamp).toLocaleTimeString('en', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false
                })}
              </span>
              <StatusDot kind={eventToKind(event.type)} size={5} />
              <span
                style={{
                  color: 'var(--fg-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {getEventContent(event)}
              </span>
            </div>
          ))
        )}
      </DrawerSection>

      {/* Metadata */}
      <DrawerSection eyebrow="META" title="Details">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}>
          <MetaRow label="Created" value={formatTimestamp(task.created_at)} />
          {task.started_at && <MetaRow label="Started" value={formatTimestamp(task.started_at)} />}
          {task.completed_at && (
            <MetaRow label="Completed" value={formatTimestamp(task.completed_at)} />
          )}
          {task.pr_url && task.pr_number && (
            <MetaRow label="PR" value={`#${task.pr_number} (${task.pr_status ?? 'unknown'})`} />
          )}
          {agentRunId && (
            <button
              onClick={() => onViewAgents(agentRunId)}
              style={{
                alignSelf: 'flex-start',
                height: 24,
                padding: '0 var(--s-2)',
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--fg-2)',
                cursor: 'pointer',
                marginTop: 'var(--s-1)'
              }}
            >
              View in Agents →
            </button>
          )}
        </div>
      </DrawerSection>

      {/* Failure details */}
      {(task.status === 'failed' || task.status === 'error' || task.status === 'cancelled') && (
        <DrawerSection
          eyebrow="FAIL"
          title={task.status === 'cancelled' ? 'Cancellation' : 'Failure'}
        >
          <div
            data-testid="task-drawer-failure"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--s-2)',
              padding: 'var(--s-3)',
              borderRadius: 'var(--r-md)',
              border: '1px solid color-mix(in oklch, var(--st-failed) 25%, transparent)',
              background: 'color-mix(in oklch, var(--st-failed) 8%, var(--bg))'
            }}
          >
            {task.failure_reason && <FailureChip reason={task.failure_reason} />}
            {task.failure_reason && (
              <pre
                data-testid="task-drawer-failure-reason"
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--fg-2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {task.failure_reason}
              </pre>
            )}
            {task.notes &&
              task.failure_reason === 'timeout' &&
              task.notes.toLowerCase().includes('watchdog') && (
                <div
                  data-testid="task-drawer-watchdog-verdict"
                  style={{ fontSize: 11, color: 'var(--fg-2)' }}
                >
                  Watchdog terminated this agent. Increase the task&apos;s{' '}
                  <strong>max runtime</strong> or split the work into smaller tasks.
                </div>
              )}
            {renderFailureNotes(task.notes)}
            {recentAgentErrors.length > 0 && (
              <div
                data-testid="task-drawer-failure-errors"
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}
                >
                  Recent errors
                </span>
                {recentAgentErrors.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: 'var(--st-failed)',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {e.type === 'agent:error' ? e.message : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DrawerSection>
      )}

      {/* Branch-only: PR creation failed */}
      {task.pr_status === 'branch_only' && (
        <DrawerSection eyebrow="PR" title="Branch pushed">
          <span
            data-testid="branch-only-section"
            style={{ fontSize: 11, color: 'var(--st-failed)' }}
          >
            PR creation failed after retries
          </span>
          {ghConfigured && buildBranchOnlyPrLink(task.notes)}
        </DrawerSection>
      )}

      {/* Override — operator escape-hatches */}
      {(showMarkFailed || showForceDone || showForceRelease) && (
        <DrawerSection eyebrow="OPS" title="Override">
          <div
            data-testid="task-drawer-override"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-1)' }}
          >
            {showForceRelease && (
              <button
                data-testid="task-drawer-force-release"
                onClick={handleForceRelease}
                style={{
                  flex: 1,
                  height: 26,
                  padding: '0 var(--s-2)',
                  background: 'transparent',
                  color: 'var(--st-failed)',
                  border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                Force Release
              </button>
            )}
            {showMarkFailed && (
              <button
                data-testid="task-drawer-mark-failed"
                onClick={handleMarkFailed}
                style={{
                  flex: 1,
                  height: 26,
                  padding: '0 var(--s-2)',
                  background: 'transparent',
                  color: 'var(--st-failed)',
                  border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                Mark Failed
              </button>
            )}
            {showForceDone && (
              <button
                data-testid="task-drawer-force-done"
                onClick={handleForceDone}
                style={{
                  flex: 1,
                  height: 26,
                  padding: '0 var(--s-2)',
                  background: 'transparent',
                  color: 'var(--st-failed)',
                  border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                Force Done
              </button>
            )}
          </div>
        </DrawerSection>
      )}

      <TextareaPromptModal {...reasonPromptProps} />
      <ConfirmModal {...forceDoneConfirmProps} />
      <ConfirmModal {...forceReleaseConfirmProps} />
      <ConfirmModal {...deleteConfirmProps} />
    </div>
  )
}

// --- Private helpers ---

interface MetaRowProps {
  label: string
  value: string
}

function MetaRow({ label, value }: MetaRowProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'baseline' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-4)',
          flexShrink: 0,
          minWidth: 64
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{value}</span>
    </div>
  )
}

interface FailureChipProps {
  reason: string
}

function FailureChip({ reason }: FailureChipProps): React.JSX.Element {
  const category = failureCategoryForReason(reason)
  return (
    <span
      data-testid="task-drawer-failure-chip"
      style={{
        alignSelf: 'flex-start',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 'var(--r-sm)',
        background: 'color-mix(in oklch, var(--st-failed) 20%, transparent)',
        color: 'var(--st-failed)',
        border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)'
      }}
    >
      {category.label}
    </span>
  )
}

function getEventContent(event: { type: string; [key: string]: unknown }): string {
  if (event.type === 'agent:text') return String(event.text ?? '')
  if (event.type === 'agent:tool_call') return `[${event.tool}] ${event.summary}`
  if (event.type === 'agent:tool_result') return `[${event.tool}] ${event.summary}`
  if (event.type === 'agent:error') return String(event.message ?? event.type)
  return event.type
}

const GH_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
const GH_BRANCH_PATTERN = /^[a-zA-Z0-9/_.-]+$/
const BRANCH_PUSHED_PATTERN = /Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/

function buildBranchOnlyPrLink(notes: string | null | undefined): React.ReactNode {
  if (!notes) return null
  const match = notes.match(BRANCH_PUSHED_PATTERN)
  if (!match) return null
  const [, branch, ghRepo] = match
  if (!branch || !ghRepo) return null
  if (!GH_REPO_PATTERN.test(ghRepo)) return null
  if (!GH_BRANCH_PATTERN.test(branch)) return null
  const href = `https://github.com/${encodeURIComponent(ghRepo)}/pull/new/${encodeURIComponent(branch)}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        alignSelf: 'flex-start',
        height: 24,
        padding: '0 var(--s-2)',
        background: 'var(--accent)',
        color: 'var(--accent-fg)',
        border: 'none',
        borderRadius: 'var(--r-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        textDecoration: 'none'
      }}
    >
      Create PR →
    </a>
  )
}
