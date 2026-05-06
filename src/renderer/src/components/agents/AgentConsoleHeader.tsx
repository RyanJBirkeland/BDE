/**
 * AgentConsoleHeader — 48px V2 header for AgentConsole.
 * Shows agent identity, live stats (tokens/cost/elapsed), and action buttons.
 *
 * All IPC lifecycle (kill, promote, log copy, context-token poll) is delegated
 * to `useAgentConsoleActions`. Inline styles live in `./AgentConsoleHeader.styles`.
 * This file is composition + UI orchestration only.
 */
import { useState } from 'react'
import './AgentConsoleHeader.css'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { useTerminalStore } from '../../stores/terminal'
import { toast } from '../../stores/toasts'
import { formatDuration, formatElapsed } from '../../lib/format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import {
  useAgentConsoleActions,
  type ContextTokens
} from '../../hooks/useAgentConsoleActions'
import {
  STAT_BLOCK_STYLE,
  STAT_LABEL_STYLE,
  STAT_VALUE_STYLE,
  IDENTITY_PRIMARY_STYLE,
  IDENTITY_SECONDARY_STYLE,
  IDENTITY_STACK_STYLE,
  HEADER_CONTAINER_STYLE,
  STATS_ROW_STYLE,
  STATS_DIVIDER_STYLE,
  ACTIONS_DIVIDER_STYLE,
  ACTIONS_ROW_STYLE,
  STATUS_DOT_STYLE,
  SPACER_STYLE,
  actionBtnStyle
} from './AgentConsoleHeader.styles'

export interface AgentConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function StatBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={STAT_BLOCK_STYLE}>
      <span style={STAT_VALUE_STYLE}>{value}</span>
      <span style={STAT_LABEL_STYLE}>{label}</span>
    </div>
  )
}

function formatTokenCount(tokens: number): string {
  if (tokens <= 0) return '—'
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1_000)}k`
}

function deriveTokenValue(contextTokens: ContextTokens | null, isRunning: boolean): string {
  if (contextTokens == null) return '—'
  return formatTokenCount(isRunning ? contextTokens.current : contextTokens.peak)
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

function getDuration(agent: AgentMeta): string {
  if (agent.finishedAt) {
    return formatDuration(agent.startedAt, agent.finishedAt)
  }
  return formatElapsed(new Date(agent.startedAt).getTime())
}

function canPromoteAgent(agent: AgentMeta): boolean {
  return (
    (agent.status === 'done' || agent.status === 'running') &&
    !!agent.worktreePath &&
    !agent.sprintTaskId
  )
}

export function AgentConsoleHeader({ agent, events }: AgentConsoleHeaderProps): React.JSX.Element {
  const isRunning = agent.status === 'running'
  const { confirm, confirmProps } = useConfirm()
  const {
    contextTokens,
    buildKillConfirmation,
    killAgent,
    promoteToReview,
    copyLogToClipboard
  } = useAgentConsoleActions(agent)

  const [duration, setDuration] = useState(() => getDuration(agent))
  useBackoffInterval(() => setDuration(getDuration(agent)), isRunning ? 1000 : null)

  const completedEvent = events.find(
    (e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed'
  )
  const costUsd = completedEvent?.costUsd ?? agent.costUsd

  const handleOpenShell = (): void => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async (): Promise<void> => {
    try {
      const { message, hasUncommittedWork } = await buildKillConfirmation()
      const confirmed = await confirm({
        title: 'Stop agent?',
        message,
        confirmLabel: 'Stop agent',
        variant: hasUncommittedWork ? 'danger' : 'default'
      })
      if (!confirmed) return
      await killAgent()
    } catch (err) {
      toast.error(`Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return (
    <>
      <div style={HEADER_CONTAINER_STYLE}>
        <span className={`fleet-dot--${agent.status}`} style={STATUS_DOT_STYLE} />
        <div style={IDENTITY_STACK_STYLE}>
          <span style={IDENTITY_PRIMARY_STYLE}>{agent.id}</span>
          <span style={IDENTITY_SECONDARY_STYLE}>{deriveSubtitleLine(agent)}</span>
        </div>
        <div style={SPACER_STYLE} />
        <div style={STATS_ROW_STYLE}>
          <StatBlock label="tokens" value={deriveTokenValue(contextTokens, isRunning)} />
          <div style={STATS_DIVIDER_STYLE} />
          <StatBlock label="cost" value={costUsd != null ? `$${costUsd.toFixed(4)}` : '—'} />
          <div style={STATS_DIVIDER_STYLE} />
          <StatBlock label="elapsed" value={duration} />
        </div>
        <div style={ACTIONS_DIVIDER_STYLE} />
        <div style={ACTIONS_ROW_STYLE}>
          {canPromoteAgent(agent) && (
            <button onClick={promoteToReview} style={actionBtnStyle('accent')}>
              Promote → Review
            </button>
          )}
          {isRunning && (
            <button onClick={handleStop} style={actionBtnStyle('danger')} aria-label="Stop agent">
              Kill
            </button>
          )}
          <button
            onClick={copyLogToClipboard}
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
