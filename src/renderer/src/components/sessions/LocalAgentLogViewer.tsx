import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { cwdToRepoLabel } from './LocalAgentRow'
import { Button } from '../ui/Button'

// ── Helpers ──────────────────────────────────────────────

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return ''
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ── Stream-JSON Parser ──────────────────────────────────

interface ChatItemText {
  kind: 'text'
  text: string
}

interface ChatItemToolUse {
  kind: 'tool_use'
  id: string
  name: string
  input: string
}

interface ChatItemToolResult {
  kind: 'tool_result'
  toolUseId: string
  content: string
}

interface ChatItemResult {
  kind: 'result'
  subtype: string
  result: string
  costUsd: number | null
}

interface ChatItemPlain {
  kind: 'plain'
  text: string
}

type ChatItem = ChatItemText | ChatItemToolUse | ChatItemToolResult | ChatItemResult | ChatItemPlain

function parseStreamJson(raw: string): { items: ChatItem[]; isStreaming: boolean } {
  const lines = raw.split('\n')
  const items: ChatItem[] = []
  let currentText = ''
  let hasMessageStop = false
  let hasResult = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      // Not valid JSON — render as plain text fallback
      items.push({ kind: 'plain', text: trimmed })
      continue
    }

    const type = parsed.type as string | undefined

    switch (type) {
      case 'content_block_delta': {
        const delta = parsed.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          currentText += delta.text
        }
        break
      }

      case 'content_block_stop': {
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        break
      }

      case 'tool_use': {
        // Flush any accumulated text before a tool call
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        const inputRaw = parsed.input
        let inputStr: string
        if (typeof inputRaw === 'string') {
          inputStr = inputRaw
        } else if (inputRaw && typeof inputRaw === 'object') {
          inputStr = JSON.stringify(inputRaw, null, 2)
        } else {
          inputStr = ''
        }
        items.push({
          kind: 'tool_use',
          id: String(parsed.id ?? ''),
          name: String(parsed.name ?? 'tool'),
          input: inputStr
        })
        break
      }

      case 'tool_result': {
        const content = parsed.content
        items.push({
          kind: 'tool_result',
          toolUseId: String(parsed.tool_use_id ?? ''),
          content: typeof content === 'string' ? content : JSON.stringify(content ?? '')
        })
        break
      }

      case 'result': {
        // Flush text
        if (currentText) {
          items.push({ kind: 'text', text: currentText })
          currentText = ''
        }
        const costRaw = parsed.cost_usd
        items.push({
          kind: 'result',
          subtype: String(parsed.subtype ?? ''),
          result: String(parsed.result ?? ''),
          costUsd: typeof costRaw === 'number' ? costRaw : null
        })
        hasResult = true
        break
      }

      case 'message_stop':
        hasMessageStop = true
        break

      // message_start, content_block_start — no-op, just structural markers
      default:
        break
    }
  }

  // Flush any trailing accumulated text (still streaming)
  if (currentText) {
    items.push({ kind: 'text', text: currentText })
  }

  const isStreaming = !hasMessageStop && !hasResult && items.length > 0

  return { items, isStreaming }
}

// ── Inline Markdown Renderer ────────────────────────────

function renderContent(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{renderInline(text.slice(lastIndex, match.index))}</span>)
    }
    parts.push(
      <pre key={key++} className="chat-msg__code-block">
        <code>{match[2]}</code>
      </pre>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{renderInline(text.slice(lastIndex))}</span>)
  }

  return <>{parts}</>
}

function renderInline(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0
  const inlineRe = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} className="chat-msg__text-plain">{text.slice(lastIndex, match.index)}</span>
      )
    }
    parts.push(
      <code key={key++} className="chat-msg__inline-code">{match[1]}</code>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} className="chat-msg__text-plain">{text.slice(lastIndex)}</span>
    )
  }

  return <>{parts}</>
}

// ── Truncate helper ─────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '\u2026'
}

// ── Chat Body (shared between both viewer components) ───

interface ChatBodyProps {
  logContent: string
  isRunning: boolean
  elapsed: string
}

function AgentChatBody({ logContent, isRunning, elapsed }: ChatBodyProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set())

  const { items, isStreaming } = useMemo(() => parseStreamJson(logContent), [logContent])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logContent, autoScroll])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  const handleResume = (): void => {
    setAutoScroll(true)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

  const toggleTool = useCallback((idx: number) => {
    setExpandedTools((prev) => {
      const n = new Set(prev)
      n.has(idx) ? n.delete(idx) : n.add(idx)
      return n
    })
  }, [])

  const toggleExpand = useCallback((idx: number) => {
    setExpandedMsgs((prev) => {
      const n = new Set(prev)
      n.has(idx) ? n.delete(idx) : n.add(idx)
      return n
    })
  }, [])

  // Find the last text item index for streaming cursor
  const lastTextIdx = isStreaming || isRunning
    ? items.reduce((acc, item, i) => (item.kind === 'text' ? i : acc), -1)
    : -1

  // Find the result item
  const resultItem = items.find((i): i is ChatItemResult => i.kind === 'result')

  return (
    <>
      <div className="agent-chat__body" ref={scrollRef} onScroll={handleScroll}>
        {items.map((item, idx) => {
          switch (item.kind) {
            case 'text': {
              const isLong = item.text.length > 600
              const isExpanded = expandedMsgs.has(idx)
              const showCursor = idx === lastTextIdx

              return (
                <div key={idx} className="chat-msg chat-msg--assistant">
                  <div className="agent-chat__avatar">{'\u2B21'}</div>
                  <div
                    className={`chat-msg__bubble chat-msg__bubble--assistant${isLong && !isExpanded ? ' chat-msg__bubble--collapsed' : ''}`}
                    onClick={isLong ? () => toggleExpand(idx) : undefined}
                  >
                    <span className="chat-msg__text chat-msg__text--rich">
                      {renderContent(item.text)}
                      {showCursor && (
                        <span className="agent-log__cursor">{'\u258B'}</span>
                      )}
                    </span>
                    {isLong && !isExpanded && (
                      <div className="chat-msg__expand-fade">
                        <span className="chat-msg__expand-label">Click to expand</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            case 'tool_use':
              return (
                <div key={idx} className="chat-msg chat-msg--tool">
                  <button className="log-msg__tool-toggle" onClick={() => toggleTool(idx)}>
                    <span className="log-msg__tool-arrow">{expandedTools.has(idx) ? '\u25BE' : '\u25B8'}</span>
                    <span className="log-msg__tool-name">{item.name}</span>
                    <span className="log-msg__tool-preview">{truncate(item.input, 80)}</span>
                  </button>
                  {expandedTools.has(idx) && (
                    <pre className="log-msg__tool-args">{item.input}</pre>
                  )}
                </div>
              )

            case 'tool_result':
              return (
                <div key={idx} className="agent-chat__tool-result">
                  <span className="log-msg__tool-label">Result</span>
                  <span className="agent-chat__tool-result-text">{truncate(item.content, 200)}</span>
                </div>
              )

            case 'result':
              // Rendered in the footer bar instead
              return null

            case 'plain':
              return (
                <div key={idx} className="agent-chat__plain-line">
                  {item.text}
                </div>
              )
          }
        })}
      </div>

      {/* Result footer bar */}
      {resultItem && (
        <div className={`agent-log__exit-bar${resultItem.subtype === 'error' ? ' agent-log__exit-bar--failed' : ''}`}>
          {resultItem.subtype === 'success' ? '\u2713' : '\u2717'}{' '}
          {resultItem.result || (resultItem.subtype === 'success' ? 'Done' : 'Failed')}
          {resultItem.costUsd != null && ` \u00B7 $${resultItem.costUsd.toFixed(3)}`}
          {elapsed && ` \u00B7 ${elapsed}`}
        </div>
      )}

      {/* Resume auto-scroll pill */}
      {!autoScroll && (
        <Button
          variant="ghost"
          size="sm"
          className="agent-log__resume"
          onClick={handleResume}
        >
          Resume auto-scroll
        </Button>
      )}
    </>
  )
}

// ── AgentLogViewer (history-store, by ID) ───────────────

/** Log viewer for a history agent (by ID) */
export function AgentLogViewer({ agentId }: { agentId: string }): React.JSX.Element {
  const agents = useAgentHistoryStore((s) => s.agents)
  const logContent = useAgentHistoryStore((s) => s.logContent)
  const clearSelection = useAgentHistoryStore((s) => s.clearSelection)

  const agent = agents.find((a) => a.id === agentId) ?? null

  const [, setTick] = useState(0)
  const isRunning = agent?.status === 'running'

  // Tick for elapsed time
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isRunning])

  const elapsed = agent
    ? isRunning
      ? formatElapsed(new Date(agent.startedAt).getTime())
      : formatDuration(agent.startedAt, agent.finishedAt)
    : ''

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
      <AgentChatBody logContent={logContent} isRunning={isRunning} elapsed={elapsed} />
    </div>
  )
}

// ── LocalAgentLogViewer (PID-based, legacy) ─────────────

/** Log viewer for a live local agent (by PID) — legacy fallback */
export function LocalAgentLogViewer({ pid }: { pid: number }): React.JSX.Element {
  const processes = useLocalAgentsStore((s) => s.processes)
  const spawnedAgents = useLocalAgentsStore((s) => s.spawnedAgents)
  const logContent = useLocalAgentsStore((s) => s.logContent)
  const selectLocalAgent = useLocalAgentsStore((s) => s.selectLocalAgent)
  const startLogPolling = useLocalAgentsStore((s) => s.startLogPolling)
  const stopLogPolling = useLocalAgentsStore((s) => s.stopLogPolling)
  const sendToAgent = useLocalAgentsStore((s) => s.sendToAgent)

  const proc = processes.find((p) => p.pid === pid)
  const spawned = spawnedAgents.find((a) => a.pid === pid)
  const isAlive = !!proc
  const isInteractive = !!spawned?.interactive && isAlive

  const [, setTick] = useState(0)
  const [steerInput, setSteerInput] = useState('')
  const [sentMessages, setSentMessages] = useState<string[]>([])

  // Tick for elapsed time
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // Start polling the log file
  useEffect(() => {
    if (!spawned?.logPath) return
    startLogPolling(spawned.logPath)
    return () => stopLogPolling()
  }, [spawned?.logPath, startLogPolling, stopLogPolling])

  const repoLabel = proc ? cwdToRepoLabel(proc.cwd) : spawned ? cwdToRepoLabel(spawned.repoPath) : '?'
  const elapsed = proc
    ? formatElapsed(proc.startedAt)
    : spawned
      ? formatElapsed(spawned.spawnedAt)
      : ''

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
          <span className="agent-log__meta">{elapsed}</span>
          {isAlive ? (
            <span className="agent-log__status agent-log__status--running">running</span>
          ) : (
            <span className="agent-log__status agent-log__status--finished">{'\u25CF'} Finished</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectLocalAgent(null)}
          title="Close log viewer"
        >
          {'\u2715'}
        </Button>
      </div>
      <AgentChatBody logContent={logContent} isRunning={isAlive} elapsed={elapsed} />

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
