/**
 * AgentsView — Neon command center: Fleet List + Agent Console (two-pane).
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Plus, Info, X } from 'lucide-react'
import '../assets/agents.css'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useAgentEventsStore } from '../stores/agentEvents'
import { AgentList } from '../components/agents/AgentList'
import { AgentConsole } from '../components/agents/AgentConsole'
import { AgentLaunchpad } from '../components/agents/AgentLaunchpad'
import { EmptyState } from '../components/ui/EmptyState'
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
  const [showScratchpadBanner, setShowScratchpadBanner] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
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

  // Check if scratchpad banner has been dismissed
  useEffect(() => {
    window.api.settings.get('scratchpad.noticeDismissed').then((val) => {
      if (!val) {
        setShowScratchpadBanner(true)
      }
    })
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

  const handleDismissBanner = useCallback(() => {
    setShowScratchpadBanner(false)
    window.api.settings.set('scratchpad.noticeDismissed', 'true')
  }, [])

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

  const handleSteer = useCallback(
    async (message: string, attachment?: Attachment) => {
      if (!selectedId) return

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

      const result = await window.api.steerAgent(selectedId, textFormattedMessage, images)
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
        width: '100%',
        height: '100%',
        minWidth: 600,
        overflow: 'hidden',
        background: 'var(--bde-bg)'
      }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      {/* Zone 1: Fleet List + Agent Console */}
      <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={20} minSize={12} maxSize={40}>
        {/* Fleet sidebar */}
        <div className="agents-sidebar">
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid var(--bde-accent-border)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
              <div
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                <Info
                  size={14}
                  style={{
                    color: 'var(--bde-text-muted)',
                    cursor: 'help',
                    transition: 'color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--bde-accent)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--bde-text-muted)'
                  }}
                  aria-describedby="scratchpad-tooltip"
                />
                {showTooltip && (
                  <div
                    id="scratchpad-tooltip"
                    role="tooltip"
                    style={{
                      position: 'absolute',
                      top: '20px',
                      left: '0',
                      width: '240px',
                      padding: '8px 10px',
                      background: 'var(--bde-accent-surface)',
                      border: '1px solid var(--bde-accent-border)',
                      borderRadius: '6px',
                      fontSize: '10px',
                      lineHeight: 1.4,
                      color: 'var(--bde-text-muted)',
                      zIndex: 1000,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                    }}
                  >
                    <strong style={{ color: 'var(--bde-accent)' }}>Scratchpad.</strong> Agents here run
                    in isolated worktrees and aren&apos;t tracked in the sprint pipeline. When an agent
                    finishes, click <em>Promote to Code Review</em> in its console header to flow the
                    work into the review queue. For tracked sprint work, queue tasks from{' '}
                    <em>Task Workbench</em>.
                  </div>
                )}
              </div>
            </div>
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
                border: '1px solid var(--bde-accent-border)',
                background: 'var(--bde-accent-surface)',
                color: 'var(--bde-accent)',
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

          {/* Dismissable banner for first-time users */}
          {showScratchpadBanner && (
            <div
              role="status"
              style={{
                fontSize: '10px',
                lineHeight: 1.4,
                padding: '8px 12px',
                borderBottom: '1px solid var(--bde-accent-border)',
                background: 'var(--bde-accent-surface)',
                color: 'var(--bde-text-muted)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px'
              }}
            >
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--bde-accent)' }}>Scratchpad.</strong> Agents here run in
                isolated worktrees and aren&apos;t tracked in the sprint pipeline. When an agent
                finishes, click <em>Promote to Code Review</em> in its console header to flow the work
                into the review queue. For tracked sprint work, queue tasks from{' '}
                <em>Task Workbench</em>.
              </div>
              <button
                onClick={handleDismissBanner}
                aria-label="Dismiss scratchpad notice"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--bde-text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--bde-accent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--bde-text-muted)'
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

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
        </Panel>
        <Separator className="panel-separator" />
        <Panel minSize={40}>
        {/* Agent Console */}
        <div style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
        </Panel>
      </Group>
    </motion.div>
  )
}
