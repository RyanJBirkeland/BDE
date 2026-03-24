/**
 * AgentsView — unified agent workflow hub.
 * Left panel: agent list with running/recent/history grouping.
 * Right panel: agent detail with chat renderer and steering.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import '../assets/agents.css'
import { useUIStore } from '../stores/ui'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { AgentList } from '../components/agents/AgentList'
import { AgentDetail } from '../components/agents/AgentDetail'
import { HealthBar } from '../components/agents/HealthBar'
import { SpawnModal } from '../components/agents/SpawnModal'
import { tokens } from '../design-system/tokens'
import { POLL_SESSIONS_INTERVAL } from '../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

export function AgentsView() {
  const reduced = useReducedMotion()
  const activeView = useUIStore((s) => s.activeView)
  const agents = useAgentHistoryStore((s) => s.agents)
  const agentsLoading = useAgentHistoryStore((s) => s.loading)
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
    <motion.div className="agents-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} variants={VARIANTS.fadeIn} initial="initial" animate="animate" transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}>
      {/* HealthBar */}
      <HealthBarWrapper />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Left sidebar */}
      <div style={{ width: sidebarWidth, minWidth: 200, borderRight: `1px solid ${tokens.color.border}`, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="agents-view__sidebar-header">
          <span className="agents-view__title text-gradient-aurora">
            Agents
          </span>
          <button
            className="agents-view__spawn-btn"
            onClick={() => setSpawnOpen(true)}
            title="Spawn Agent"
          >
            <Plus size={14} />
          </button>
        </div>

        <AgentList
          agents={agents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={agentsLoading}
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
    </motion.div>
  )
}

function HealthBarWrapper() {
  const [status, setStatus] = useState<{
    running: boolean
    concurrency: { maxSlots: number; activeCount: number; cooldownUntil: number } | null
    activeAgents: Array<unknown>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.agentManager.status().then((s) => {
        if (!cancelled) setStatus(s)
      }).catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const connected = status !== null && status.running
  const stats = status
    ? { queued: 0, active: status.activeAgents.length, doneToday: 0, failed: 0 }
    : null

  return <HealthBar connected={connected} stats={stats} />
}
