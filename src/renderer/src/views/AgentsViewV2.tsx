/**
 * AgentsViewV2 — Three-pane agents command center.
 *
 * Layout: FleetList (320px fixed) | Center (1fr) | Inspector (320px, Console mode only).
 *
 * Center pane renders one of three modes:
 *   - AgentLaunchpad: when user clicked "Spawn" or no agents exist yet
 *   - AgentConsole:   when a specific agent is selected
 *   - FleetGlance:    when agents exist but none is selected
 *
 * Inspector renders inline at ≥1280px and as a slide-over overlay at <1280px,
 * triggered by the toggle button. Hidden in Launchpad and Glance modes.
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useAgentHistoryStore, type AgentMeta } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { AgentList } from '../components/agents/AgentList'
import { AgentConsole } from '../components/agents/AgentConsole'
import { AgentLaunchpad } from '../components/agents/AgentLaunchpad'
import { FleetGlance } from '../components/agents/FleetGlance'
import { AgentInspector } from '../components/agents/AgentInspector'
import { toast } from '../stores/toasts'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { buildLocalAgentMessage } from '../adapters/attachments'
import type { Attachment, AgentEvent } from '../../../shared/types'
import { useAgentViewLifecycle } from '../hooks/useAgentViewLifecycle'
import { useAgentViewCommands } from '../hooks/useAgentViewCommands'
import { useAgentSlashCommands } from '../hooks/useAgentSlashCommands'
import { useScratchpadNotice } from '../hooks/useScratchpadNotice'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

const INSPECTOR_BREAKPOINT = 1280
const EMPTY_EVENTS: never[] = []

function fleetListWidth(viewportWidth: number): number {
  if (viewportWidth < 700) return 0
  if (viewportWidth < 960) return 220
  if (viewportWidth < 1200) return 260
  return 320
}

export function AgentsViewV2(): React.JSX.Element {
  const reduced = useReducedMotion()
  const activeView = usePanelLayoutStore((s) => s.activeView)
  const agents = useAgentHistoryStore((s) => s.agents)
  const fetched = useAgentHistoryStore((s) => s.fetched)
  const fetchError = useAgentHistoryStore((s) => s.fetchError)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  const displayedCount = useAgentHistoryStore((s) => s.displayedCount)
  const hasMore = useAgentHistoryStore((s) => s.hasMore)
  const loadMore = useAgentHistoryStore((s) => s.loadMore)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // When nothing is explicitly selected, fall back to the first agent to avoid
  // a useEffect+setState cascade that would cause cascading renders.
  const activeId = selectedId ?? agents[0]?.id ?? null

  const [showLaunchpad, setShowLaunchpad] = useState(false)
  const { showBanner: showScratchpadBanner, dismiss: dismissScratchpadBanner } =
    useScratchpadNotice()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = (): void => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => setViewportWidth(window.innerWidth), 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (debounceTimer !== null) clearTimeout(debounceTimer)
    }
  }, [])

  const isWide = viewportWidth >= INSPECTOR_BREAKPOINT

  // Clears the active selection so the launchpad replaces any visible console.
  const openLaunchpad = useCallback(() => {
    setSelectedId(null)
    setShowLaunchpad(true)
  }, [])

  useAgentViewLifecycle({
    activeView,
    activeId,
    fetchAgents,
    loadHistory,
    setShowLaunchpad: openLaunchpad,
  })

  const handleClearConsole = useCallback(() => {
    if (!activeId) {
      toast.info('No agent selected')
      return
    }
    useAgentEventsStore.getState().clear(activeId)
  }, [activeId])

  useAgentViewCommands({ onSpawnAgent: openLaunchpad, handleClearConsole })

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedId(id)
    setShowLaunchpad(false)
  }, [])

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === activeId),
    [agents, activeId]
  )
  const events = useAgentEventsStore((s) => s.events[activeId ?? ''] ?? EMPTY_EVENTS)

  const handleSteer = useCallback(
    async (message: string, attachment?: Attachment) => {
      if (!activeId) return
      const textFormattedMessage =
        attachment?.type === 'text' ? buildLocalAgentMessage(message, [attachment]) : message
      const images =
        attachment?.type === 'image' && attachment.data && attachment.mimeType
          ? [{ data: attachment.data, mimeType: attachment.mimeType }]
          : undefined
      const result = await window.api.agents.steer(activeId, textFormattedMessage, images)
      if (!result.ok) toast.error(result.error ?? 'Failed to send message to agent')
    },
    [activeId]
  )

  const { handleCommand } = useAgentSlashCommands({ activeId, selectedAgent })

  const listWidth = fleetListWidth(viewportWidth)
  const isConsoleMode = !!(selectedAgent && activeId && !showLaunchpad)
  const showInspectorInline = isConsoleMode && isWide
  const showInspectorOverlay = isConsoleMode && !isWide && inspectorOpen

  return (
    <ErrorBoundary name="AgentsViewV2">
      <motion.div
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
        style={{
          display: 'flex',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--bg)',
          position: 'relative',
        }}
      >
        {listWidth > 0 && (
          <FleetListPane
            listWidth={listWidth}
            onSpawn={openLaunchpad}
            onDismissBanner={dismissScratchpadBanner}
            onSelectAgent={handleSelectAgent}
            showScratchpadBanner={showScratchpadBanner}
            activeId={activeId}
            agents={agents}
            fetched={fetched}
            fetchError={fetchError}
            fetchAgents={fetchAgents}
            displayedCount={displayedCount}
            hasMore={hasMore}
            loadMore={loadMore}
          />
        )}

        <CenterPane
          showLaunchpad={showLaunchpad}
          selectedAgent={selectedAgent}
          activeId={activeId}
          agents={agents}
          onAgentSpawned={() => {
            setShowLaunchpad(false)
            fetchAgents()
          }}
          onCancelLaunchpad={agents.length > 0 ? () => setShowLaunchpad(false) : undefined}
          onSelectAgent={handleSelectAgent}
          onSpawn={openLaunchpad}
          onSteer={handleSteer}
          onCommand={handleCommand}
        />

        {(showInspectorInline || showInspectorOverlay) && selectedAgent && (
          <InspectorPane
            agent={selectedAgent}
            events={events}
            asOverlay={showInspectorOverlay}
          />
        )}

        {isConsoleMode && !isWide && (
          <InspectorToggleButton
            isOpen={inspectorOpen}
            onToggle={() => setInspectorOpen((o) => !o)}
          />
        )}
      </motion.div>
    </ErrorBoundary>
  )
}

// --- Sub-renderers -------------------------------------------------------

interface FleetListPaneProps {
  agents: AgentMeta[]
  activeId: string | null
  fetched: boolean
  fetchError: string | null
  fetchAgents: () => void
  displayedCount: number
  hasMore: boolean
  loadMore: () => void
  showScratchpadBanner: boolean
  listWidth: number
  onSpawn: () => void
  onDismissBanner: () => void
  onSelectAgent: (id: string) => void
}

function FleetListPane({
  agents,
  activeId,
  fetched,
  fetchError,
  fetchAgents,
  displayedCount,
  hasMore,
  loadMore,
  showScratchpadBanner,
  listWidth,
  onSpawn,
  onDismissBanner,
  onSelectAgent,
}: FleetListPaneProps): React.JSX.Element {
  return (
    <div style={{
      width: listWidth,
      flexShrink: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <AgentList
        agents={agents}
        selectedId={activeId}
        onSelect={onSelectAgent}
        onKill={fetchAgents}
        loading={!fetched && agents.length === 0 && !fetchError}
        fetchError={fetchError}
        onRetry={fetchAgents}
        displayedCount={displayedCount}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onSpawn={onSpawn}
        showBanner={showScratchpadBanner}
        onDismissBanner={onDismissBanner}
      />
    </div>
  )
}

interface CenterPaneProps {
  showLaunchpad: boolean
  selectedAgent: AgentMeta | undefined
  activeId: string | null
  agents: AgentMeta[]
  onAgentSpawned: () => void
  onCancelLaunchpad: (() => void) | undefined
  onSelectAgent: (id: string) => void
  onSpawn: () => void
  onSteer: (message: string, attachment?: Attachment) => Promise<void>
  onCommand: (cmd: string, args?: string) => void
}

function CenterPane({
  showLaunchpad,
  selectedAgent,
  activeId,
  agents,
  onAgentSpawned,
  onCancelLaunchpad,
  onSelectAgent,
  onSpawn,
  onSteer,
  onCommand,
}: CenterPaneProps): React.JSX.Element {
  const showLaunchpadState = showLaunchpad || (!selectedAgent && agents.length === 0)

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {showLaunchpadState ? (
        <AgentLaunchpad onAgentSpawned={onAgentSpawned} onCancel={onCancelLaunchpad} />
      ) : selectedAgent && activeId ? (
        <AgentConsole agentId={activeId} onSteer={onSteer} onCommand={onCommand} />
      ) : (
        <FleetGlance agents={agents} onSelect={onSelectAgent} onSpawn={onSpawn} />
      )}
    </div>
  )
}

interface InspectorPaneProps {
  agent: AgentMeta
  events: AgentEvent[] | undefined
  asOverlay: boolean
}

function InspectorPane({ agent, events, asOverlay }: InspectorPaneProps): React.JSX.Element {
  const overlayStyles: React.CSSProperties = asOverlay
    ? { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10 }
    : {}

  return (
    <div style={{ height: '100%', ...overlayStyles }}>
      <AgentInspector agent={agent} events={events ?? []} />
    </div>
  )
}

interface InspectorToggleButtonProps {
  isOpen: boolean
  onToggle: () => void
}

function InspectorToggleButton({ isOpen, onToggle }: InspectorToggleButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'absolute',
        top: 56,
        right: isOpen ? 328 : 8,
        zIndex: 11,
        height: 24,
        padding: '0 var(--s-2)',
        background: 'var(--surf-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        color: 'var(--fg-3)',
      }}
    >
      {isOpen ? 'Close inspector' : 'Inspector'}
    </button>
  )
}
