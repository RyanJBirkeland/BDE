/**
 * AgentsView — Neon command center with three stacked zones:
 * 1. Live Activity Strip (running agents as pills)
 * 2. Fleet List + Agent Console (two-pane)
 * 3. Timeline Waterfall (Gantt-style)
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, Activity, ChevronRight } from 'lucide-react'
import '../assets/agents.css'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { AgentList } from '../components/agents/AgentList'
import { AgentConsole } from '../components/agents/AgentConsole'
import { LiveActivityStrip } from '../components/agents/LiveActivityStrip'
import { AgentLaunchpad } from '../components/agents/AgentLaunchpad'
import { EmptyState } from '../components/ui/EmptyState'
import { NeonCard, MiniChart, type ChartBar } from '../components/neon'
import { toast } from '../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'
import { buildLocalAgentMessage } from '../lib/attachments'
import type { Attachment } from '../../../shared/types'

export function AgentsView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const activeView = usePanelLayoutStore((s) => s.activeView)
  const agents = useAgentHistoryStore((s) => s.agents)
  const fetched = useAgentHistoryStore((s) => s.fetched)
  const fetchError = useAgentHistoryStore((s) => s.fetchError)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  const displayedCount = useAgentHistoryStore((s) => s.displayedCount)
  const hasMore = useAgentHistoryStore((s) => s.hasMore)
  const loadMore = useAgentHistoryStore((s) => s.loadMore)
  const initEvents = useAgentEventsStore((s) => s.init)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showLaunchpad, setShowLaunchpad] = useState(false)
  const [chartCollapsed, setChartCollapsed] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  // Initialize event listener once
  useEffect(() => {
    cleanupRef.current = initEvents()
    return () => cleanupRef.current?.()
  }, [initEvents])

  // Fetch agent history when view becomes active
  useEffect(() => {
    if (activeView !== 'agents') return
    fetchAgents()
  }, [fetchAgents, activeView])

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
    const handler = (): void => {
      setSelectedId(null)
      setShowLaunchpad(true)
    }
    window.addEventListener('bde:open-spawn-modal', handler)
    return () => window.removeEventListener('bde:open-spawn-modal', handler)
  }, [])

  // Register agent commands in command palette
  const handleSpawnAgent = useCallback(() => {
    setSelectedId(null)
    setShowLaunchpad(true)
  }, [])

  const handleClearConsole = useCallback(() => {
    if (!selectedId) {
      toast.info('No agent selected')
      return
    }
    // Emit event for AgentConsole to handle
    window.dispatchEvent(
      new CustomEvent('agent:clear-console', { detail: { agentId: selectedId } })
    )
  }, [selectedId])

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'agent-spawn',
        label: 'Spawn Agent',
        category: 'action',
        keywords: ['spawn', 'new', 'agent', 'create', 'launch'],
        action: handleSpawnAgent
      },
      {
        id: 'agent-clear-console',
        label: 'Clear Console',
        category: 'action',
        keywords: ['clear', 'console', 'reset', 'clean'],
        action: handleClearConsole
      }
    ]

    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [handleSpawnAgent, handleClearConsole, registerCommands, unregisterCommands])

  const selectedAgent = agents.find((a) => a.id === selectedId)

  // Build line chart data: agent completions per hour over the last 6 hours
  const activityChartData = useMemo((): ChartBar[] => {
    // eslint-disable-next-line react-hooks/purity -- Date.now() in memo is intentional for time bucketing
    const now = Date.now()
    const sixHoursAgo = now - 6 * 3600 * 1000
    const buckets: { hour: number; count: number }[] = []

    // Create 6 one-hour buckets
    for (let i = 0; i < 6; i++) {
      buckets.push({ hour: sixHoursAgo + i * 3600 * 1000, count: 0 })
    }

    // Count agents that started in each bucket
    for (const agent of agents) {
      const started = new Date(agent.startedAt).getTime()
      if (started < sixHoursAgo) continue
      const bucketIdx = Math.min(Math.floor((started - sixHoursAgo) / 3600000), buckets.length - 1)
      buckets[bucketIdx].count++
    }

    return buckets.map((b) => ({
      value: b.count,
      accent: 'cyan' as const,
      label: new Date(b.hour).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }))
  }, [agents])

  const handleSteer = useCallback(
    async (message: string, attachment?: Attachment) => {
      if (!selectedId) return
      const formattedMessage = attachment
        ? buildLocalAgentMessage(message, [attachment])
        : message
      const result = await window.api.steerAgent(selectedId, formattedMessage)
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to send message to agent')
      }
    },
    [selectedId]
  )

  const handleCommand = useCallback(
    async (cmd: string, _args?: string) => {
      if (!selectedId || !selectedAgent) return
      switch (cmd) {
        case '/stop':
          try {
            await window.api.killAgent(selectedId)
          } catch (err) {
            toast.error(
              `Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          }
          break
        case '/retry':
          if (selectedAgent.sprintTaskId) {
            try {
              await window.api.sprint.update(selectedAgent.sprintTaskId, { status: 'queued' })
              toast.success('Task re-queued')
            } catch (err) {
              toast.error(`Retry failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
            }
          } else {
            toast.info('Adhoc agents cannot be retried — spawn a new agent instead')
          }
          break
        case '/focus':
          if (_args) {
            const focusResult = await window.api.steerAgent(selectedId, `Focus on: ${_args}`)
            if (!focusResult.ok) toast.error(focusResult.error ?? 'Failed to send focus message')
          }
          break
        case '/checkpoint': {
          const taskId = selectedAgent.sprintTaskId
          if (!taskId) {
            toast.info('/checkpoint only works for pipeline agents with a sprint task')
            break
          }
          try {
            const result = await window.api.agentManager.checkpoint(taskId, _args)
            if (result.ok) {
              toast.success(
                result.committed ? 'Checkpoint committed' : (result.error ?? 'Nothing to commit')
              )
            } else {
              toast.error(`Checkpoint failed: ${result.error ?? 'unknown error'}`)
            }
          } catch (err) {
            toast.error(
              `Checkpoint failed: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          }
          break
        }
        case '/test': {
          const result = await window.api.steerAgent(
            selectedId,
            'Please run the test suite now with `npm test` (or the project-appropriate command) and report the results before continuing.'
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /test steering')
          else toast.success('Asked agent to run tests')
          break
        }
        case '/scope': {
          if (!_args) {
            toast.info('Usage: /scope <file> [file…]')
            break
          }
          const result = await window.api.steerAgent(
            selectedId,
            `Please narrow your focus to only these files for now: ${_args}. Do not modify anything outside this scope without asking first.`
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /scope steering')
          else toast.success('Scope updated')
          break
        }
        case '/status': {
          const result = await window.api.steerAgent(
            selectedId,
            'Please give a brief status report: what you have completed so far, what you are working on right now, and what remains.'
          )
          if (!result.ok) toast.error(result.error ?? 'Failed to send /status steering')
          break
        }
        default:
          break
      }
    },
    [selectedId, selectedAgent]
  )

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedId(id)
    setShowLaunchpad(false)
  }, [])

  return (
    <motion.div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 600,
        background: 'var(--neon-bg)'
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
        <div className="agents-sidebar">
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid var(--neon-purple-border)'
            }}
          >
            <span
              className="text-gradient-aurora"
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                fontWeight: 600
              }}
            >
              Fleet
            </span>
            <button
              onClick={() => {
                setSelectedId(null)
                setShowLaunchpad(true)
              }}
              title="New Agent"
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
                padding: 0
              }}
            >
              <Plus size={12} />
            </button>
          </div>

          <AgentList
            agents={agents}
            selectedId={selectedId}
            onSelect={handleSelectAgent}
            onKill={fetchAgents}
            loading={!fetched && agents.length === 0 && !fetchError}
            fetchError={fetchError}
            onRetry={fetchAgents}
            displayedCount={displayedCount}
            hasMore={hasMore}
            onLoadMore={loadMore}
          />
        </div>

        {/* Agent Console */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {showLaunchpad || (!selectedAgent && agents.length === 0) ? (
            <AgentLaunchpad
              onAgentSpawned={() => {
                setShowLaunchpad(false)
                fetchAgents()
              }}
            />
          ) : selectedAgent ? (
            <AgentConsole
              agentId={selectedAgent.id}
              onSteer={handleSteer}
              onCommand={handleCommand}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%'
              }}
            >
              <EmptyState
                title="No agent selected"
                description="Select an agent from the fleet list to view its console output."
              />
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Agent Activity Chart */}
      <div style={{ padding: '0 12px 12px' }}>
        <button
          onClick={() => setChartCollapsed(!chartCollapsed)}
          aria-label={chartCollapsed ? 'Expand activity chart' : 'Collapse activity chart'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'none',
            border: 'none',
            color: 'var(--neon-cyan)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '6px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: chartCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 150ms ease'
            }}
          />
          Activity
        </button>
        {!chartCollapsed && (
          <NeonCard
            accent="cyan"
            title="Agent Activity — Last 6 Hours"
            icon={<Activity size={12} />}
          >
            <MiniChart data={activityChartData} height={80} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                color: 'var(--neon-text-dim)',
                fontSize: '9px',
                marginTop: '4px',
                fontFamily: 'var(--bde-font-code)'
              }}
            >
              {activityChartData.length > 0 && (
                <>
                  <span>{activityChartData[0].label}</span>
                  <span>{activityChartData[activityChartData.length - 1].label}</span>
                </>
              )}
            </div>
          </NeonCard>
        )}
      </div>
    </motion.div>
  )
}
