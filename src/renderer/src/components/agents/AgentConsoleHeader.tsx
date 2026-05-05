/**
 * AgentConsoleHeader — 48px V2 header for AgentConsole.
 * Shows agent identity, live stats (tokens/cost/elapsed), and action buttons.
 */
import { useState, useCallback, useEffect } from 'react'
import './AgentConsoleHeader.css'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { useTerminalStore } from '../../stores/terminal'
import { toast } from '../../stores/toasts'
import { formatDuration, formatElapsed } from '../../lib/format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'

export interface AgentConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function StatBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--fg)',
          fontWeight: 500,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          textTransform: 'uppercase',
          color: 'var(--fg-3)',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
    </div>
  )
}

function actionBtnStyle(variant: 'accent' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 26,
    padding: '0 var(--s-3)',
    fontSize: 12,
    borderRadius: 'var(--r-md)',
    cursor: 'pointer',
    fontWeight: 500,
  }
  if (variant === 'accent') {
    return { ...base, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none' }
  }
  if (variant === 'danger') {
    return {
      ...base,
      background: 'transparent',
      border: `1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)`,
      color: 'var(--st-failed)',
    }
  }
  return {
    ...base,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: 'var(--fg-2)',
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens <= 0) return '—'
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1_000)}k`
}

function deriveTokenValue(
  contextTokens: { current: number; peak: number } | null,
  isRunning: boolean
): string {
  if (contextTokens == null) return '—'
  const count = isRunning ? contextTokens.current : contextTokens.peak
  return formatTokenCount(count)
}

function deriveSubtitleLine(agent: AgentMeta): string {
  const parts: string[] = [agent.repo]
  if (agent.worktreePath) {
    parts.push(`worktree:${agent.worktreePath.split('/').pop() ?? ''}`)
  }
  if (agent.pid) {
    parts.push(`pid ${agent.pid}`)
  }
  parts.push(`started ${new Date(agent.startedAt).toLocaleTimeString()}`)
  return parts.join(' · ')
}

export function AgentConsoleHeader({ agent, events }: AgentConsoleHeaderProps): React.JSX.Element {
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
              .slice(0, 10)
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

  return (
    <>
      <div
        style={{
          height: 48,
          flexShrink: 0,
          padding: '0 var(--s-5)',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
        }}
      >
        {/* Status dot — static, not pulse */}
        <span
          className={`fleet-dot--${agent.status}`}
          style={{ width: 8, height: 8, flexShrink: 0 }}
        />

        {/* Two-line identity stack */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflow: 'hidden',
            flex: '0 1 auto',
            maxWidth: 220,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.id}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {deriveSubtitleLine(agent)}
          </span>
        </div>

        {/* Center spacer */}
        <div style={{ flex: 1 }} />

        {/* Stats row with vertical separators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <StatBlock label="tokens" value={deriveTokenValue(contextTokens, isRunning)} />
          <div
            style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 var(--s-2)' }}
          />
          <StatBlock label="cost" value={costUsd != null ? `$${costUsd.toFixed(4)}` : '—'} />
          <div
            style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 var(--s-2)' }}
          />
          <StatBlock label="elapsed" value={duration} />
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 var(--s-1)' }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 'var(--s-1)', alignItems: 'center' }}>
          {canPromote && (
            <button onClick={handlePromote} style={actionBtnStyle('accent')}>
              Promote → Review
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleStop}
              style={actionBtnStyle('danger')}
              aria-label="Stop agent"
            >
              Kill
            </button>
          )}
          <button
            onClick={handleCopyLog}
            style={actionBtnStyle('secondary')}
            aria-label="Copy log"
          >
            Copy log
          </button>
          <button
            onClick={handleOpenShell}
            style={actionBtnStyle('secondary')}
            aria-label="Open terminal"
          >
            Shell
          </button>
        </div>
      </div>
      <ConfirmModal {...confirmProps} />
    </>
  )
}
