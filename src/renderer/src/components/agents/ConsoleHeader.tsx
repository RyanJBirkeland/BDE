/**
 * ConsoleHeader — 56px glass header for AgentConsole with status, model, duration, cost, and actions.
 */
import { useState, useCallback, useEffect } from 'react'
import { Terminal, StopCircle, Copy, GitPullRequest } from 'lucide-react'
import './ConsoleHeader.css'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { NeonBadge, type NeonAccent } from '../neon'
import { useTerminalStore } from '../../stores/terminal'
import { toast } from '../../stores/toasts'
import { formatDuration, formatElapsed } from '../../lib/format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { derivePhaseLabel } from '../../lib/agent-phase'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'

interface ConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function getModelAccent(model: string): NeonAccent {
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'purple'
  if (lower.includes('sonnet')) return 'cyan'
  if (lower.includes('haiku')) return 'pink'
  return 'blue'
}

export function ConsoleHeader({ agent, events }: ConsoleHeaderProps): React.JSX.Element {
  const isRunning = agent.status === 'running'
  const { confirm, confirmProps } = useConfirm()
  const getDuration = (): string => {
    if (agent.finishedAt) {
      return formatDuration(agent.startedAt, agent.finishedAt)
    }
    return formatElapsed(new Date(agent.startedAt).getTime())
  }
  const [duration, setDuration] = useState(() => getDuration())

  // Context-window token counter — per-turn size (latest turn while running,
  // peak turn once finished). Computed from agent_run_turns by the main process.
  const [contextTokens, setContextTokens] = useState<{
    current: number
    peak: number
  } | null>(null)
  const fetchContextTokens = useCallback(async () => {
    const result = await window.api.agents.getContextTokens(agent.id)
    if (result != null) {
      setContextTokens({
        current: result.contextWindowTokens,
        peak: result.peakContextTokens
      })
    }
  }, [agent.id])
  useBackoffInterval(fetchContextTokens, isRunning ? 3000 : null, { maxMs: 10_000 })
  useEffect(() => {
    if (isRunning) return
    let cancelled = false
    window.api.agents
      .getContextTokens(agent.id)
      .then((result) => {
        if (cancelled || result == null) return
        setContextTokens({
          current: result.contextWindowTokens,
          peak: result.peakContextTokens
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agent.id, isRunning])

  // Live duration ticker for running agents
  useBackoffInterval(
    () => {
      setDuration(
        agent.finishedAt
          ? formatDuration(agent.startedAt, agent.finishedAt)
          : formatElapsed(new Date(agent.startedAt).getTime())
      )
    },
    isRunning ? 1000 : null
  )

  // Extract cost from completed event or agent meta
  const completedEvent = events.find(
    (e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed'
  )
  const costUsd = completedEvent?.costUsd ?? agent.costUsd

  const handleOpenShell = (): void => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async (): Promise<void> => {
    try {
      // Pipeline agents are keyed by sprintTaskId in AgentManager, adhoc agents by id
      const killId = agent.sprintTaskId ?? agent.id

      // Build confirmation message based on whether agent has a worktree
      let message = 'This will terminate the SDK session.'
      let hasUncommittedWork = false

      if (agent.worktreePath) {
        // Fetch git status to check for uncommitted changes
        try {
          const statusResult = await window.api.git.status(agent.worktreePath)
          if (statusResult.files.length > 0) {
            hasUncommittedWork = true
            const fileList = statusResult.files
              .slice(0, 10) // Show first 10 files
              .map((f) => `  ${f.status} ${f.path}`)
              .join('\n')
            const moreFiles =
              statusResult.files.length > 10
                ? `\n  ... and ${statusResult.files.length - 10} more`
                : ''
            message = `This agent has uncommitted changes in its worktree. Killing it will leave those changes on disk but will not commit or push them.\n\nUncommitted files:\n${fileList}${moreFiles}`
          } else {
            message =
              'This agent has a worktree but no uncommitted changes. The worktree will remain on disk.'
          }
        } catch {
          // If git status fails, show a generic message
          message = 'This agent has a worktree. Killing it may leave uncommitted changes on disk.'
        }
      }

      const confirmed = await confirm({
        title: 'Stop agent?',
        message,
        confirmLabel: 'Stop agent',
        variant: hasUncommittedWork ? 'danger' : 'default'
      })

      if (!confirmed) return

      await window.api.agents.kill(killId)
    } catch (err) {
      toast.error(`Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleCopyLog = async (): Promise<void> => {
    try {
      const result = await window.api.agents.tailLog({ logPath: agent.logPath, fromByte: 0 })
      await navigator.clipboard.writeText(result.content)
      toast.success('Log copied to clipboard')
    } catch (err) {
      toast.error(`Failed to copy log: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Promote action: available for any agent with a worktree that doesn't already
  // have a sprint task. Works mid-session (running) or after completion (done).
  // Pipeline agents already have sprintTaskId, so they're excluded automatically.
  const canPromote =
    (agent.status === 'done' || agent.status === 'running') &&
    !!agent.worktreePath &&
    !agent.sprintTaskId

  const handlePromote = async (): Promise<void> => {
    try {
      const result = await window.api.agents.promoteToReview(agent.id)
      if (!result.ok || !result.taskId) {
        toast.error(result.error ?? 'Failed to promote agent to Code Review')
        return
      }
      toast.success('Promoted to Code Review')
      // Switch the active view to Code Review and select the new task
      usePanelLayoutStore.getState().setView('code-review')
      useCodeReviewStore.getState().selectTask(result.taskId)
    } catch (err) {
      toast.error(`Failed to promote: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Status dot class based on agent status
  const statusDotClass = `console-header__status-dot console-header__status-dot--${agent.status}`

  return (
    <>
      <div className="console-header">
        {/* Status dot */}
        <div className={statusDotClass} />

        {/* Task name */}
        <div className="console-header__task-name" title={agent.task}>
          {agent.task}
        </div>

        {/* Model badge */}
        <NeonBadge accent={getModelAccent(agent.model)} label={agent.model} pulse={isRunning} />

        {/* Meta info */}
        <div className="console-header__meta">
          <span>{duration}</span>
          {isRunning && (
            <span
              className="console-header__phase"
              data-testid="console-header-phase"
              aria-label={`Agent phase: ${derivePhaseLabel(events)}`}
            >
              {derivePhaseLabel(events)}
            </span>
          )}
          {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
          {(() => {
            if (contextTokens == null) return null
            const tokens = isRunning ? contextTokens.current : contextTokens.peak
            if (tokens <= 0) return null
            const label =
              tokens >= 1_000_000
                ? `${(tokens / 1_000_000).toFixed(1)}M`
                : `${Math.round(tokens / 1_000)}k`
            return (
              <span
                title={
                  isRunning
                    ? 'Context window size on the latest turn'
                    : 'Peak context window size across the run'
                }
              >
                ctx {label}
              </span>
            )
          })()}
        </div>

        {/* Action buttons */}
        <div className="console-header__actions">
          <button
            className="console-header__action-btn"
            onClick={handleOpenShell}
            title="Open terminal in agent directory"
            aria-label="Open terminal"
          >
            <Terminal size={14} />
          </button>

          {isRunning && (
            <button
              className="console-header__action-btn"
              onClick={handleStop}
              title="Stop agent"
              aria-label="Stop agent"
            >
              <StopCircle size={14} />
            </button>
          )}

          {canPromote && (
            <button
              className="console-header__action-btn"
              onClick={handlePromote}
              title="Promote this scratchpad agent's work to Code Review"
              aria-label="Promote to Code Review"
              style={{ color: 'var(--fleet-accent)' }}
            >
              <GitPullRequest size={14} />
            </button>
          )}

          <button
            className="console-header__action-btn"
            onClick={handleCopyLog}
            title="Copy full log to clipboard"
            aria-label="Copy log"
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
      <ConfirmModal {...confirmProps} />
    </>
  )
}
