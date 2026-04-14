import { useEffect, useMemo, useRef, useState } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { formatElapsed, getDotColor } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { TaskDetailActionButtons } from './TaskDetailActionButtons'
import { AgentActivityPreview } from './AgentActivityPreview'
import { UpstreamOutcomes } from './UpstreamOutcomes'
import { useGitHubStatus } from '../../hooks/useGitHubStatus'
import { useDrawerResize } from '../../hooks/useDrawerResize'

import './TaskDetailDrawer.css'

export interface TaskDetailDrawerProps {
  task: SprintTask
  onClose: () => void
  onLaunch: (task: SprintTask) => void
  onStop: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
  onDelete: (task: SprintTask) => void
  onViewLogs: (task: SprintTask) => void
  onOpenSpec: () => void
  onEdit: (task: SprintTask) => void
  onViewAgents: (agentId: string) => void
  onUnblock?: (task: SprintTask) => void
  onRetry?: (task: SprintTask) => void
  onReviewChanges?: (task: SprintTask) => void
  onExport?: (task: SprintTask) => void
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

export function TaskDetailDrawer({
  task,
  onClose,
  onLaunch,
  onStop,
  onRerun,
  onDelete,
  onViewLogs,
  onOpenSpec,
  onEdit,
  onViewAgents,
  onUnblock,
  onRetry,
  onReviewChanges,
  onExport
}: TaskDetailDrawerProps): React.JSX.Element {
  const [elapsed, setElapsed] = useState('')
  const { width, handleResizeStart, handleKeyDown } = useDrawerResize({
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 700
  })
  const { configured: ghConfigured } = useGitHubStatus()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [task.id])

  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setElapsed(formatElapsed(task.started_at!)), isActive ? 10_000 : null)
  // Compute initial elapsed value synchronously
  if (isActive && !elapsed) {
    setElapsed(formatElapsed(task.started_at!))
  }

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const depIds = useMemo(() => task?.depends_on?.map((d) => d.id) ?? [], [task?.depends_on])
  const allTasks = useSprintTasks((s) => s.tasks)
  const depTasks = useMemo(
    () => (depIds.length === 0 ? [] : allTasks.filter((t) => depIds.includes(t.id))),
    [depIds, allTasks]
  )
  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)

  const agentRunId = task.agent_run_id
  const agentEvents = useAgentEventsStore((s) =>
    agentRunId !== null ? s.events[agentRunId] : undefined
  )

  const activityEvents = useMemo(() => {
    if (!agentEvents) return []
    return agentEvents
      .filter(
        (e) =>
          e.type === 'agent:text' || e.type === 'agent:tool_call' || e.type === 'agent:tool_result'
      )
      .map((e, i) => {
        let content = ''
        if (e.type === 'agent:text') content = e.text
        else if (e.type === 'agent:tool_call') content = `[${e.tool}] ${e.summary}`
        else if (e.type === 'agent:tool_result') content = `[${e.tool}] ${e.summary}`
        return { id: i, content }
      })
      .filter((e) => e.content.length > 0)
  }, [agentEvents])

  return (
    <aside className="task-drawer" data-testid="task-detail-drawer" style={{ width }}>
      {/* Resize handle */}
      <div
        className="task-drawer__resize-handle"
        onMouseDown={handleResizeStart}
        onKeyDown={handleKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize drawer"
        aria-valuenow={width}
        aria-valuemin={280}
        aria-valuemax={700}
        tabIndex={0}
      />
      {/* Header */}
      <div className="task-drawer__head">
        <h2 className="task-drawer__title" ref={titleRef} tabIndex={-1}>
          {task.title}
        </h2>
        <div className="task-drawer__status">
          <span
            className="task-drawer__status-dot"
            style={{ background: getDotColor(task.status, task.pr_status) }}
          />
          <span>{task.status}</span>
          {elapsed && <span> — {elapsed}</span>}
        </div>
        <button
          className="task-drawer__close"
          onClick={onClose}
          aria-label="Close drawer"
          title="Close drawer"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="task-drawer__body">
        <div className="task-drawer__field">
          <span className="task-drawer__label">Repo</span>
          <span className="task-drawer__value">{task.repo}</span>
        </div>

        <div className="task-drawer__field">
          <span className="task-drawer__label">Priority</span>
          <span className="task-drawer__value">P{task.priority}</span>
        </div>

        {depTasks.length > 0 && (
          <div className="task-drawer__deps">
            <div className="task-drawer__deps-label">
              {task.status === 'blocked' ? 'Blocked by' : 'Dependencies'}
            </div>
            {depTasks.map((dep) => (
              <button
                key={dep.id}
                className={`task-drawer__dep task-drawer__dep--${dep.status}`}
                onClick={() => setSelectedTaskId(dep.id)}
              >
                <span className="task-drawer__dep-dot" />
                <span className="task-drawer__dep-title">{dep.title.slice(0, 50)}</span>
                <span className="task-drawer__dep-status">{dep.status}</span>
              </button>
            ))}
          </div>
        )}

        <UpstreamOutcomes upstreamTasks={depTasks} onNavigate={setSelectedTaskId} />

        <div className="task-drawer__field">
          <span className="task-drawer__label">Created</span>
          <span className="task-drawer__value">{formatTimestamp(task.created_at)}</span>
        </div>

        {task.started_at && (
          <div className="task-drawer__field">
            <span className="task-drawer__label">Started</span>
            <span className="task-drawer__value">{formatTimestamp(task.started_at)}</span>
          </div>
        )}

        {/* Prompt block */}
        {task.prompt && (
          <>
            <span className="task-drawer__prompt-label">Prompt</span>
            <div className="task-drawer__prompt">{task.prompt}</div>
          </>
        )}

        {/* Spec link */}
        {task.spec && (
          <button className="task-drawer__spec-link" onClick={onOpenSpec}>
            View Spec →
          </button>
        )}

        {/* Agent section */}
        {task.agent_run_id && (
          <button
            className="task-drawer__agent-link"
            onClick={() => onViewAgents(task.agent_run_id!)}
          >
            ● Running — View in Agents →
          </button>
        )}

        {/* Agent activity preview for active tasks */}
        {task.status === 'active' && task.agent_run_id && (
          <AgentActivityPreview events={activityEvents} />
        )}

        {/* Review Changes CTA */}
        {task.status === 'review' && onReviewChanges && (
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onReviewChanges(task)}
          >
            Review Changes →
          </button>
        )}

        {/* Failure details — show prominently when task failed/errored */}
        {(task.status === 'failed' || task.status === 'error') && (
          <div
            className="task-drawer__failure"
            data-testid="task-drawer-failure"
            style={{
              border: '1px solid var(--bde-danger-border)',
              background: 'var(--bde-danger-surface)'
            }}
          >
            <div
              className="task-drawer__failure-label"
              style={{
                color: 'var(--bde-danger)'
              }}
            >
              Failure Details
            </div>
            {task.failure_reason && (
              <div className="task-drawer__failure-reason" data-testid="task-drawer-failure-reason">
                reason: {task.failure_reason}
              </div>
            )}
            {task.notes ? (
              <pre
                className="task-drawer__failure-notes"
                data-testid="task-drawer-failure-notes"
                style={{
                  color: 'var(--bde-text, rgba(255,255,255,0.85))'
                }}
              >
                {task.notes}
              </pre>
            ) : (
              <div className="task-drawer__status-text">
                No diagnostic notes captured. Check the Agents view for details.
              </div>
            )}
            {agentEvents &&
              agentEvents.length > 0 &&
              (() => {
                const errors = agentEvents.filter((e) => e.type === 'agent:error').slice(-3)
                if (errors.length === 0) return null
                return (
                  <div
                    className="task-drawer__failure-errors"
                    data-testid="task-drawer-failure-errors"
                  >
                    <div className="task-drawer__failure-errors-label">Recent errors</div>
                    {errors.map((e, i) => (
                      <div key={i} className="task-drawer__failure-error-item">
                        {e.type === 'agent:error' ? e.message : ''}
                      </div>
                    ))}
                  </div>
                )
              })()}
          </div>
        )}

        {/* PR section */}
        {task.pr_url && task.pr_number && (
          <div className="task-drawer__field">
            <span className="task-drawer__label">PR</span>
            <span className="task-drawer__value">
              #{task.pr_number} ({task.pr_status ?? 'unknown'})
            </span>
          </div>
        )}

        {/* Branch-only: PR creation failed */}
        {task.pr_status === 'branch_only' && (
          <div className="task-drawer__branch-only" data-testid="branch-only-section">
            <span className="task-drawer__label">Branch pushed</span>
            <span className="task-drawer__value task-drawer__value--warning">
              PR creation failed after retries
            </span>
            {ghConfigured &&
              task.notes &&
              (() => {
                const match = task.notes.match(/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/)
                if (!match) return null
                const [, branch, ghRepo] = match
                // Validate ghRepo format (owner/repo) to prevent XSS
                if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(ghRepo)) return null
                // Validate branch name doesn't contain dangerous characters
                if (!/^[a-zA-Z0-9/_.-]+$/.test(branch)) return null
                return (
                  <a
                    className="task-drawer__btn task-drawer__btn--primary task-drawer__branch-only-link"
                    href={`https://github.com/${encodeURIComponent(ghRepo)}/pull/new/${encodeURIComponent(branch)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Create PR →
                  </a>
                )
              })()}
          </div>
        )}
      </div>

      {/* Actions bar */}
      <div className="task-drawer__actions">
        <TaskDetailActionButtons
          task={task}
          onLaunch={onLaunch}
          onStop={onStop}
          onRerun={onRerun}
          onDelete={onDelete}
          onViewLogs={onViewLogs}
          onEdit={onEdit}
          onUnblock={onUnblock}
          onRetry={onRetry}
          onExport={onExport}
        />
      </div>
    </aside>
  )
}
