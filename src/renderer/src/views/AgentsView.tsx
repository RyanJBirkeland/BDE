/**
 * AgentsView — unified agent workflow hub.
 * Left panel: agent list with running/recent/history grouping.
 * Right panel: agent detail with chat renderer and steering.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus } from 'lucide-react'
import { useUIStore } from '../stores/ui'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { AgentList } from '../components/agents/AgentList'
import { AgentDetail } from '../components/agents/AgentDetail'
import { HealthBar } from '../components/agents/HealthBar'
import { useSprintStore } from '../stores/sprint'
import { SpawnModal } from '../components/sessions/SpawnModal'
import { tokens } from '../design-system/tokens'
import { POLL_SESSIONS_INTERVAL } from '../lib/constants'

export function AgentsView() {
  const activeView = useUIStore((s) => s.activeView)
  const agents = useAgentHistoryStore((s) => s.agents)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  const events = useAgentEventsStore((s) => s.events)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)
  const initEvents = useAgentEventsStore((s) => s.init)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const { sidebarWidth, onResizeHandleMouseDown } = useSidebarResize()
  const cleanupRef = useRef<(() => void) | null>(null)

  // Initialize event listener once
  useEffect(() => {
    cleanupRef.current = initEvents()
    return () => cleanupRef.current?.()
  }, [initEvents])

  // Poll agent history while view is active
  useEffect(() => {
    if (activeView !== 'agents') return
    fetchAgents()
  }, [fetchAgents, activeView])
  useVisibilityAwareInterval(fetchAgents, activeView === 'agents' ? POLL_SESSIONS_INTERVAL : null)

  // Auto-select first agent if none selected
  useEffect(() => {
    if (!selectedId && agents.length > 0) {
      setSelectedId(agents[0].id)
    }
  }, [agents, selectedId])

  // Load event history when selection changes
  useEffect(() => {
    if (selectedId) {
      loadHistory(selectedId)
    }
  }, [selectedId, loadHistory])

  // Listen for spawn modal trigger from CommandPalette
  useEffect(() => {
    const handler = (): void => setSpawnOpen(true)
    window.addEventListener('bde:open-spawn-modal', handler)
    return () => window.removeEventListener('bde:open-spawn-modal', handler)
  }, [])

  const selectedAgent = agents.find((a) => a.id === selectedId)
  const selectedEvents = selectedId ? (events[selectedId] ?? []) : []

  const handleSteer = useCallback(async (message: string) => {
    if (!selectedId) return
    await window.api.steerAgent(selectedId, message)
  }, [selectedId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.color.bg }}>
      {/* HealthBar */}
      <HealthBarWrapper />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Left sidebar */}
      <div style={{ width: sidebarWidth, minWidth: 200, borderRight: `1px solid ${tokens.color.border}`, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
        }}>
          <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Agents
          </span>
          <button
            onClick={() => setSpawnOpen(true)}
            title="Spawn Agent"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              cursor: 'pointer',
              color: tokens.color.textMuted,
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <AgentList
          agents={agents}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeHandleMouseDown}
        style={{ width: 4, cursor: 'col-resize', background: 'transparent' }}
      />

      {/* Right content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {selectedAgent ? (
          <AgentDetail
            agent={selectedAgent}
            events={selectedEvents}
            onSteer={handleSteer}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: tokens.color.textDim, fontSize: tokens.size.md }}>
            {agents.length === 0 ? 'No agents yet. Spawn one to get started.' : 'Select an agent to view details.'}
          </div>
        )}
      </div>

      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />
      </div>
    </div>
  )
}

function HealthBarWrapper() {
  const queueHealth = useSprintStore((s) => s.queueHealth)
  const connected = queueHealth !== null
  const stats = queueHealth ? {
    queued: queueHealth.queue.queued ?? 0,
    active: queueHealth.queue.active ?? 0,
    doneToday: queueHealth.doneToday ?? 0,
    failed: queueHealth.queue.failed ?? 0,
  } : null

  return <HealthBar connected={connected} stats={stats} />
}
