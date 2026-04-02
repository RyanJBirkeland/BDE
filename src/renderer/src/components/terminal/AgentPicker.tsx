import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMeta } from '../../../../preload/index.d'

interface AgentPickerProps {
  onSelect: (agentId: string, label: string) => void
  onClose: () => void
}

function formatTimeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch {
    return ''
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '\u2026'
}

export function AgentPicker({ onSelect, onClose }: AgentPickerProps): React.JSX.Element {
  const [agents, setAgents] = useState<AgentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  // Load running agents
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const all = await window.api.agents.list({ status: 'running' })
        setAgents(all)
      } catch (err) {
        console.error('Failed to load agents:', err)
        setAgents([])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSelect = useCallback(
    (agent: AgentMeta) => {
      const label = `${agent.repo} \u2014 ${truncate(agent.task, 30)}`
      onSelect(agent.id, label)
    },
    [onSelect]
  )

  return (
    <div ref={ref} className="agent-picker">
      {/* Header */}
      <div className="agent-picker__header">Watch Agent Output</div>
      <div className="agent-picker__divider" />

      {/* Agent list */}
      {loading ? (
        <div className="agent-picker__empty">Loading\u2026</div>
      ) : agents.length === 0 ? (
        <div className="agent-picker__empty">No running agents</div>
      ) : (
        agents.map((agent) => (
          <button key={agent.id} className="agent-picker__item" onClick={() => handleSelect(agent)}>
            <div className="agent-picker__item-left">
              <span className="agent-picker__icon">{'\u{1F916}'}</span>
              <span className="agent-picker__repo">{agent.repo}</span>
              <span className="agent-picker__task">{truncate(agent.task, 50)}</span>
            </div>
            <span className="agent-picker__time">{formatTimeAgo(agent.startedAt)}</span>
          </button>
        ))
      )}
    </div>
  )
}
