/**
 * AgentsView — Neon command center: Fleet List + Agent Console (two-pane).
 */
import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Info, X } from 'lucide-react'
import './AgentsViewV1.css'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { AgentList } from '../components/agents/AgentList'
import { AgentConsole } from '../components/agents/AgentConsole'
import { AgentLaunchpad } from '../components/agents/AgentLaunchpad'
import { FleetGlance } from '../components/agents/FleetGlance'
import { toast } from '../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { buildLocalAgentMessage } from '../adapters/attachments'
import type { Attachment } from '../../../shared/types'
import { useAgentViewLifecycle } from '../hooks/useAgentViewLifecycle'
import { useAgentViewCommands } from '../hooks/useAgentViewCommands'
import { useAgentSlashCommands } from '../hooks/useAgentSlashCommands'

function ScratchpadDescription(): React.JSX.Element {
  return (
    <>
      <strong className="agents-view__tooltip-strong">Scratchpad.</strong> Agents here run in
      isolated worktrees and aren&apos;t tracked in the sprint pipeline. When an agent finishes,
      click <em>Promote to Code Review</em> in its console header to flow the work into the review
      queue. For tracked sprint work, queue tasks from <em>Task Workbench</em>.
    </>
  )
}

export function AgentsViewV1(): React.JSX.Element {
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
  // Derived: when no explicit selection, fall back to the first agent.
  // Avoids a useEffect+setState cascade that triggers cascading renders.
  const activeId = selectedId ?? agents[0]?.id ?? null
  const [showLaunchpad, setShowLaunchpad] = useState(false)
  const [showScratchpadBanner, setShowScratchpadBanner] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  // openLaunchpad clears selection so the launchpad replaces any active console
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
    setShowScratchpadBanner
  })

  const handleClearConsole = useCallback(() => {
    if (!activeId) {
      toast.info('No agent selected')
      return
    }
    useAgentEventsStore.getState().clear(activeId)
  }, [activeId])

  useAgentViewCommands({ onSpawnAgent: openLaunchpad, handleClearConsole })

  const handleDismissBanner = useCallback(() => {
    setShowScratchpadBanner(false)
    window.api.settings.set('scratchpad.noticeDismissed', 'true')
  }, [])

  const selectedAgent = agents.find((a) => a.id === activeId)

  const handleSteer = useCallback(
    async (message: string, attachment?: Attachment) => {
      if (!activeId) return

      // Text file attachments get prepended to the message as code blocks.
      // Image attachments are passed separately so the main process can build
      // a proper multimodal SDK message instead of embedding them as markdown
      // (which Claude cannot see as visual content).
      const textFormattedMessage =
        attachment?.type === 'text' ? buildLocalAgentMessage(message, [attachment]) : message

      const images =
        attachment?.type === 'image' && attachment.data && attachment.mimeType
          ? [{ data: attachment.data, mimeType: attachment.mimeType }]
          : undefined

      const result = await window.api.agents.steer(activeId, textFormattedMessage, images)
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to send message to agent')
      }
    },
    [activeId]
  )

  const { handleCommand } = useAgentSlashCommands({ activeId, selectedAgent })

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedId(id)
    setShowLaunchpad(false)
  }, [])

  return (
    <ErrorBoundary name="AgentsView">
      <motion.div
        className="agents-view"
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <div className="view-layout">
          <div className="agents-sidebar view-sidebar">
            {/* Header */}
            <div className="agents-view__sidebar-header">
              <div className="agents-view__title-wrapper">
                <span className="text-gradient-aurora agents-view__title">Fleet</span>
                <button
                  className="agents-view__info-wrapper"
                  aria-label="About scratchpad agents"
                  aria-describedby="scratchpad-tooltip"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  onFocus={() => setShowTooltip(true)}
                  onBlur={() => setShowTooltip(false)}
                >
                  <Info
                    size={14}
                    className="agents-view__info-icon"
                    aria-hidden="true"
                  />
                  {showTooltip && (
                    <div id="scratchpad-tooltip" role="tooltip" className="agents-view__tooltip">
                      <ScratchpadDescription />
                    </div>
                  )}
                </button>
              </div>
              <button onClick={openLaunchpad} title="New Agent" className="agents-view__spawn-btn">
                <Plus size={12} />
              </button>
            </div>

            {/* Dismissable banner for first-time users */}
            {showScratchpadBanner && (
              <div role="status" className="agents-view__scratchpad-banner">
                <div className="agents-view__scratchpad-banner-text">
                  <ScratchpadDescription />
                </div>
                <button
                  onClick={handleDismissBanner}
                  aria-label="Dismiss scratchpad notice"
                  className="agents-view__scratchpad-banner-dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <AgentList
              agents={agents}
              selectedId={activeId}
              onSelect={handleSelectAgent}
              onSpawn={openLaunchpad}
              onKill={fetchAgents}
              loading={!fetched && agents.length === 0 && !fetchError}
              fetchError={fetchError}
              onRetry={fetchAgents}
              displayedCount={displayedCount}
              hasMore={hasMore}
              onLoadMore={loadMore}
            />
          </div>
          <div className="view-content">
            {showLaunchpad || (!selectedAgent && agents.length === 0) ? (
              <AgentLaunchpad
                onAgentSpawned={() => {
                  setShowLaunchpad(false)
                  fetchAgents()
                }}
              />
            ) : selectedAgent && activeId ? (
              <AgentConsole agentId={activeId} onSteer={handleSteer} onCommand={handleCommand} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  overflow: 'auto'
                }}
              >
                <FleetGlance agents={agents} onSelect={handleSelectAgent} onSpawn={openLaunchpad} />
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </ErrorBoundary>
  )
}
