/**
 * AgentsView — Neon command center with three stacked zones:
 * 1. Live Activity Strip (running agents as pills)
 * 2. Fleet List + Agent Console (two-pane)
 * 3. Timeline Waterfall (Gantt-style)
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import '../assets/agents.css'
import { useUIStore } from '../stores/ui'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { AgentList } from '../components/agents/AgentList'
import { AgentConsole } from '../components/agents/AgentConsole'
import { LiveActivityStrip } from '../components/agents/LiveActivityStrip'
import { AgentTimeline } from '../components/agents/AgentTimeline'
import { SpawnModal } from '../components/agents/SpawnModal'
import { tokens } from '../design-system/tokens'
import { toast } from '../stores/toasts'
import { POLL_SESSIONS_INTERVAL } from '../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

export function AgentsView() {
  const reduced = useReducedMotion()
  const activeView = useUIStore((s) => s.activeView)
  const agents = useAgentHistoryStore((s) => s.agents)
  const agentsLoading = useAgentHistoryStore((s) => s.loading)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  const initEvents = useAgentEventsStore((s) => s.init)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spawnOpen, setSpawnOpen] = useState(false)
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

  const handleSteer = useCallback(async (message: string) => {
    if (!selectedId) return
    const result = await window.api.steerAgent(selectedId, message)
    if (!result.ok) {
      toast.error(result.error ?? 'Failed to send message to agent')
    }
  }, [selectedId])

  const handleCommand = useCallback(async (cmd: string, _args?: string) => {
    if (!selectedId || !selectedAgent) return
    switch (cmd) {
      case '/stop':
        await window.api.killAgent(selectedId)
        break
      case '/retry':
        if (selectedAgent.sprintTaskId) {
          await window.api.sprint.update(selectedAgent.sprintTaskId, { status: 'queued' })
        }
        break
      case '/focus':
        if (_args) {
          const focusResult = await window.api.steerAgent(selectedId, `Focus on: ${_args}`)
          if (!focusResult.ok) toast.error(focusResult.error ?? 'Failed to send focus message')
        }
        break
      default:
        break
    }
  }, [selectedId, selectedAgent])

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  return (
    <motion.div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--neon-bg)',
      }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      {/* Zone 1: Live Activity Strip */}
      <LiveActivityStrip onSelectAgent={handleSelectAgent} />

      {/* Zone 2: Fleet List + Agent Console */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Fleet sidebar */}
        <div style={{
          width: 220,
          minWidth: 180,
          borderRight: `1px solid var(--neon-purple-border)`,
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(138, 43, 226, 0.04), rgba(10, 0, 21, 0.4))',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--neon-purple-border)',
          }}>
            <span style={{
              color: 'var(--neon-purple)',
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              fontWeight: 600,
            }}>
              Fleet
            </span>
            <button
              onClick={() => setSpawnOpen(true)}
              title="Spawn Agent"
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--neon-cyan-border)',
                background: 'var(--neon-cyan-surface)',
                color: 'var(--neon-cyan)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Plus size={12} />
            </button>
          </div>

          <AgentList
            agents={agents}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={agentsLoading}
          />
        </div>

        {/* Agent Console */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {selectedAgent ? (
            <AgentConsole
              agentId={selectedAgent.id}
              onSteer={handleSteer}
              onCommand={handleCommand}
            />
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'rgba(255, 255, 255, 0.2)',
              fontSize: tokens.size.md,
              fontFamily: 'var(--bde-font-code)',
            }}>
              {agents.length === 0
                ? '> No agents yet. Spawn one to get started.'
                : '> Select an agent to view console.'}
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Timeline Waterfall */}
      <AgentTimeline agents={agents} onSelectAgent={handleSelectAgent} />

      {/* Spawn Modal */}
      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </motion.div>
  )
}
