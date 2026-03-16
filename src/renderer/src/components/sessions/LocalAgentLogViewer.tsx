import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { cwdToRepoLabel } from './LocalAgentRow'
import { Button } from '../ui/Button'

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function classifyLine(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('failed') || lower.startsWith('!'))
    return 'agent-log__line--error'
  if (
    lower.includes('reading') ||
    lower.includes('read ') ||
    lower.includes('searching') ||
    lower.includes('grep')
  )
    return 'agent-log__line--read'
  if (
    lower.includes('writing') ||
    lower.includes('wrote') ||
    lower.includes('creating') ||
    lower.includes('edit')
  )
    return 'agent-log__line--write'
  return ''
}

export function LocalAgentLogViewer({ pid }: { pid: number }): React.JSX.Element {
  const processes = useLocalAgentsStore((s) => s.processes)
  const spawnedAgents = useLocalAgentsStore((s) => s.spawnedAgents)
  const logContent = useLocalAgentsStore((s) => s.logContent)
  const selectLocalAgent = useLocalAgentsStore((s) => s.selectLocalAgent)
  const startLogPolling = useLocalAgentsStore((s) => s.startLogPolling)
  const stopLogPolling = useLocalAgentsStore((s) => s.stopLogPolling)

  const proc = processes.find((p) => p.pid === pid)
  const spawned = spawnedAgents.find((a) => a.pid === pid)
  const isAlive = !!proc

  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [, setTick] = useState(0)

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

  const repoLabel = proc ? cwdToRepoLabel(proc.cwd) : spawned ? cwdToRepoLabel(spawned.repoPath) : '?'
  const elapsed = proc
    ? formatElapsed(proc.startedAt)
    : spawned
      ? formatElapsed(spawned.spawnedAt)
      : ''

  const lines = logContent.split('\n')

  return (
    <div className="agent-log">
      <div className="agent-log__header">
        <div className="agent-log__header-left">
          <span className="agent-log__icon">⬡</span>
          <span className="agent-log__bin">claude</span>
          <span className="agent-log__repo">~/{repoLabel}</span>
          <span className="agent-log__meta">pid {pid}</span>
          <span className="agent-log__meta">{elapsed}</span>
          {isAlive ? (
            <span className="agent-log__status agent-log__status--running">running</span>
          ) : (
            <span className="agent-log__status agent-log__status--finished">● Finished</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectLocalAgent(null)}
          title="Close log viewer"
        >
          ✕
        </Button>
      </div>
      <div className="agent-log__body" ref={scrollRef} onScroll={handleScroll}>
        {lines.map((line, i) => (
          <div key={i} className={`agent-log__line ${classifyLine(line)}`}>
            {line}
          </div>
        ))}
        {isAlive && <span className="agent-log__cursor">▋</span>}
      </div>
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
    </div>
  )
}
