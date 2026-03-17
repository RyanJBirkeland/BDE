import { useEffect, useState, useCallback, useMemo } from 'react'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { useTerminalStore } from '../../stores/terminal'
import { cwdToRepoLabel } from '../../lib/utils'
import { Button } from '../ui/Button'
import { parseStreamJson } from '../../lib/stream-parser'
import { chatItemsToMessages } from '../../lib/agent-messages'
import { ChatThread } from './ChatThread'
import { formatElapsed, formatDuration, formatTime } from '../../lib/format'

// ── Isolated tick component (avoids re-rendering parent every second) ──

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>{formatElapsed(startedAt)}</span>
}

// ── Truncation banner ────────────────────────────────────

function LogTruncationBanner({ trimmedLines }: { trimmedLines: number }): React.JSX.Element | null {
  if (trimmedLines <= 0) return null
  return (
    <div className="agent-log__truncation-banner">
      [... {trimmedLines.toLocaleString()} earlier lines trimmed ...]
    </div>
  )
}

// ── AgentLogViewer (history-store, by ID) ───────────────

/** Log viewer for a history agent (by ID) */
export function AgentLogViewer({ agentId }: { agentId: string }): React.JSX.Element {
  const agents = useAgentHistoryStore((s) => s.agents)
  const logContent = useAgentHistoryStore((s) => s.logContent)
  const logTrimmedLines = useAgentHistoryStore((s) => s.logTrimmedLines)
  const clearSelection = useAgentHistoryStore((s) => s.clearSelection)

  const agent = agents.find((a) => a.id === agentId) ?? null

  const isRunning = agent?.status === 'running'

  const { items, isStreaming } = useMemo(() => parseStreamJson(logContent), [logContent])
  const chatMessages = useMemo(() => chatItemsToMessages(items), [items])

  return (
    <div className="agent-log">
      <div className="agent-log__header">
        <div className="agent-log__header-left">
          <span className="agent-log__icon">{'\u2B21'}</span>
          <span className="agent-log__bin">{agent?.bin ?? 'claude'}</span>
          <span className="agent-log__repo">~/{agent?.repo ?? '?'}</span>
          <span className="agent-log__meta">{agent?.model ?? ''}</span>
          <span className="agent-log__meta">{agent ? formatTime(agent.startedAt) : ''}</span>
          {isRunning ? (
            <span className="agent-log__status agent-log__status--running">running</span>
          ) : agent?.status === 'failed' ? (
            <span className="agent-log__status agent-log__status--failed">{'\u2717'} Failed</span>
          ) : (
            <span className="agent-log__status agent-log__status--finished">{'\u25CF'} Finished</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearSelection}
          title="Close log viewer"
        >
          {'\u2715'}
        </Button>
      </div>
      {agent?.task && (
        <div className="agent-log__task-bar">
          <span className="agent-log__task-label">Task:</span>
          <span className="agent-log__task-text">{agent.task}</span>
        </div>
      )}
      <LogTruncationBanner trimmedLines={logTrimmedLines} />
      <ChatThread messages={chatMessages} isStreaming={isRunning && isStreaming} />
    </div>
  )
}

// ── LocalAgentLogViewer (PID-based, legacy) ─────────────

/** Log viewer for a live local agent (by PID) — legacy fallback */
export function LocalAgentLogViewer({ pid }: { pid: number }): React.JSX.Element {
  const processes = useLocalAgentsStore((s) => s.processes)
  const spawnedAgents = useLocalAgentsStore((s) => s.spawnedAgents)
  const localLogContent = useLocalAgentsStore((s) => s.logContent)
  const localTrimmedLines = useLocalAgentsStore((s) => s.logTrimmedLines)
  const selectLocalAgent = useLocalAgentsStore((s) => s.selectLocalAgent)
  const startLogPolling = useLocalAgentsStore((s) => s.startLogPolling)
  const stopLogPolling = useLocalAgentsStore((s) => s.stopLogPolling)
  const sendToAgent = useLocalAgentsStore((s) => s.sendToAgent)

  // Agents spawned externally (task runner, CLI) aren't in spawnedAgents.
  // Fall back to agent history — match by PID to get logPath + metadata.
  const historyAgents = useAgentHistoryStore((s) => s.agents)
  const historyLogContent = useAgentHistoryStore((s) => s.logContent)
  const historyTrimmedLines = useAgentHistoryStore((s) => s.logTrimmedLines)
  const selectHistoryAgent = useAgentHistoryStore((s) => s.selectAgent)

  const proc = processes.find((p) => p.pid === pid)
  const spawned = spawnedAgents.find((a) => a.pid === pid)
  const historyAgent = !spawned ? historyAgents.find((a) => a.pid === pid) : null

  const logContent = historyAgent ? historyLogContent : localLogContent
  const trimmedLines = historyAgent ? historyTrimmedLines : localTrimmedLines
  const isAlive = !!proc
  const isInteractive = !!spawned?.interactive && isAlive

  const [steerInput, setSteerInput] = useState('')
  const [sentMessages, setSentMessages] = useState<string[]>([])

  const { items, isStreaming } = useMemo(() => parseStreamJson(logContent), [logContent])
  const chatMessages = useMemo(() => chatItemsToMessages(items), [items])

  // Route externally-spawned agents through history store (readLog by ID)
  useEffect(() => {
    if (historyAgent) {
      selectHistoryAgent(historyAgent.id)
      return
    }
    if (!spawned?.logPath) return
    startLogPolling(spawned.logPath)
    return () => stopLogPolling()
  }, [historyAgent?.id, spawned?.logPath, startLogPolling, stopLogPolling, selectHistoryAgent])

  const repoLabel = proc
    ? cwdToRepoLabel(proc.cwd)
    : spawned
      ? cwdToRepoLabel(spawned.repoPath)
      : historyAgent?.repo ?? '?'

  const elapsedStartedAt = proc
    ? proc.startedAt
    : spawned
      ? spawned.spawnedAt
      : historyAgent
        ? new Date(historyAgent.startedAt).getTime()
        : null

  const finishedDuration = !proc && !spawned && historyAgent?.finishedAt
    ? formatDuration(historyAgent.startedAt, historyAgent.finishedAt)
    : null

  const handleOpenInTerminal = useCallback(() => {
    const openAgentTab = useTerminalStore.getState().openAgentTab
    openAgentTab(`local:${pid}`, repoLabel)
  }, [pid, repoLabel])

  const handleSend = useCallback(() => {
    const msg = steerInput.trim()
    if (!msg) return
    sendToAgent(pid, msg)
    setSentMessages((prev) => [...prev, msg])
    setSteerInput('')
  }, [steerInput, pid, sendToAgent])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="agent-log">
      <div className="agent-log__header">
        <div className="agent-log__header-left">
          <span className="agent-log__icon">{'\u2B21'}</span>
          <span className="agent-log__bin">claude</span>
          <span className="agent-log__repo">~/{repoLabel}</span>
          <span className="agent-log__meta">pid {pid}</span>
          <span className="agent-log__meta">
            {finishedDuration
              ? finishedDuration
              : elapsedStartedAt
                ? <ElapsedTime startedAt={elapsedStartedAt} />
                : ''}
          </span>
          {isAlive ? (
            <span className="agent-log__status agent-log__status--running">running</span>
          ) : (
            <span className="agent-log__status agent-log__status--finished">{'\u25CF'} Finished</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenInTerminal}
            title="Open in terminal view"
          >
            {'\u2197'} Terminal
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectLocalAgent(null)}
            title="Close log viewer"
          >
            {'\u2715'}
          </Button>
        </div>
      </div>
      <LogTruncationBanner trimmedLines={trimmedLines} />
      <ChatThread messages={chatMessages} isStreaming={isAlive && isStreaming} />

      {/* Sent message bubbles */}
      {sentMessages.length > 0 && (
        <div className="agent-steer-sent">
          {sentMessages.map((msg, i) => (
            <div key={i} className="chat-msg chat-msg--user">
              <div className="chat-msg__bubble chat-msg__bubble--user">{msg}</div>
            </div>
          ))}
        </div>
      )}

      {/* Steer input bar */}
      {isInteractive && (
        <div className="agent-steer-input">
          <input
            className="agent-steer-input__field"
            type="text"
            placeholder="Send message to agent\u2026"
            value={steerInput}
            onChange={(e) => setSteerInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="agent-steer-input__send"
            onClick={handleSend}
            disabled={!steerInput.trim()}
          >
            Send {'\u2192'}
          </button>
        </div>
      )}
    </div>
  )
}
