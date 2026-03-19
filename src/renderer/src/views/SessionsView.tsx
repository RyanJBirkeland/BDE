/**
 * SessionsView — multi-layout chat interface for agent sessions.
 * Supports single, 2-pane, and grid-4 split modes.
 * Left pane: session list with status dots + model badge.
 * Right pane: layout depends on splitMode.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { useSessionsKeyboardShortcuts } from '../hooks/useSessionsKeyboardShortcuts'
import { Columns2, Grid2x2, Square, Plus } from 'lucide-react'
import { AgentList } from '../components/sessions/AgentList'
import { SpawnModal } from '../components/sessions/SpawnModal'
import { SessionMainContent } from '../components/sessions/SessionMainContent'
import { useSessionsStore } from '../stores/sessions'
import { useSplitLayoutStore, type SplitMode } from '../stores/splitLayout'
import { useLocalAgentsStore } from '../stores/localAgents'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { useUnifiedAgentsStore } from '../stores/unifiedAgents'
import { useUIStore } from '../stores/ui'
import { toast } from '../stores/toasts'
import { POLL_SESSIONS_INTERVAL, SEARCH_DEBOUNCE_MS } from '../lib/constants'

const SPLIT_MODES: { mode: SplitMode; icon: typeof Square; title: string }[] = [
  { mode: 'single', icon: Square, title: 'Single pane (\u2318\u21e71)' },
  { mode: '2-pane', icon: Columns2, title: '2-pane split (\u2318\u21e72)' },
  { mode: 'grid-4', icon: Grid2x2, title: '2\u00d72 grid (\u2318\u21e74)' }
]

export function SessionsView(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const splitMode = useSplitLayoutStore((s) => s.splitMode)
  const activeView = useUIStore((s) => s.activeView)

  // Unified agents store
  const fetchAll = useUnifiedAgentsStore((s) => s.fetchAll)
  const selectUnified = useUnifiedAgentsStore((s) => s.select)

  // Single unified polling interval
  useEffect(() => {
    if (activeView !== 'sessions') return
    fetchAll()
  }, [fetchAll, activeView])
  useVisibilityAwareInterval(fetchAll, activeView === 'sessions' ? POLL_SESSIONS_INTERVAL : null)

  useEffect(() => {
    if (sessions.length > 0 && !selectedKey) {
      selectSession(sessions[0].key)
    }
  }, [sessions, selectedKey, selectSession])

  const { sidebarWidth, onResizeHandleMouseDown } = useSidebarResize()

  const subAgents = useSessionsStore((s) => s.subAgents)
  const killSession = useSessionsStore((s) => s.killSession)
  const selectedLocalAgentPid = useLocalAgentsStore((s) => s.selectedLocalAgentPid)
  const killLocalAgent = useLocalAgentsStore((s) => s.killLocalAgent)
  const selectedHistoryId = useAgentHistoryStore((s) => s.selectedId)
  const selectedSession = sessions.find((s) => s.key === selectedKey)
  const selectedSubAgent = subAgents.find((a) => a.sessionKey === selectedKey) ?? null

  // Unified agent selection state
  const [selectedUnifiedId, setSelectedUnifiedId] = useState<string | null>(null)

  // Derive send mode + localPid from unified selection
  const localSendPid =
    selectedUnifiedId?.startsWith('local:') ? parseInt(selectedUnifiedId.substring(6), 10) : undefined
  const sessionMode: 'chat' | 'steer' | 'local' =
    localSendPid != null ? 'local' :
    selectedSubAgent ? 'steer' : 'chat'
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), SEARCH_DEBOUNCE_MS)
  }, [])
  const [spawnOpen, setSpawnOpen] = useState(false)

  // FC-S3: Listen for bde:open-spawn-modal from CommandPalette
  useEffect(() => {
    const handler = (): void => setSpawnOpen(true)
    window.addEventListener('bde:open-spawn-modal', handler)
    return () => window.removeEventListener('bde:open-spawn-modal', handler)
  }, [])

  // FC-S7: Sync sidebar selection when agentHistoryStore.selectedId changes externally
  useEffect(() => {
    if (selectedHistoryId) {
      setSelectedUnifiedId(`history:${selectedHistoryId}`)
    }
  }, [selectedHistoryId])

  // Unified selection handler
  const handleUnifiedSelect = useCallback(
    (id: string) => {
      setSelectedUnifiedId(id)
      selectUnified(id)
    },
    [selectUnified]
  )

  // Unified kill handler
  const handleUnifiedKill = useCallback(
    async (agent: { source: string; pid?: number; sessionKey?: string }) => {
      if (agent.source === 'local' && agent.pid) {
        await killLocalAgent(agent.pid)
        toast.success('Agent killed')
      } else if (agent.sessionKey) {
        await killSession(agent.sessionKey)
        toast.success('Session killed')
      }
    },
    [killLocalAgent, killSession]
  )

  // Unified steer handler
  const handleUnifiedSteer = useCallback(() => {
    window.dispatchEvent(new CustomEvent('bde:focus-message-input'))
  }, [])

  const { handleSplitModeChange } = useSessionsKeyboardShortcuts(selectedKey)

  return (
    <div className="sessions-chat">
      <div className="sessions-chat__sidebar" style={{ width: sidebarWidth }}>
        <div className="session-list__header">
          <span className="session-list__title bde-section-title">AGENTS</span>
          <button
            className="session-list__new-btn"
            onClick={() => setSpawnOpen(true)}
            title="Spawn Agent"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="session-list__search">
          <input
            type="text"
            placeholder="Filter agents\u2026"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleQueryChange('')
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <AgentList
          filter={debouncedQuery}
          selectedId={selectedUnifiedId}
          onSelect={handleUnifiedSelect}
          onKill={handleUnifiedKill}
          onSteer={handleUnifiedSteer}
          onSpawn={() => setSpawnOpen(true)}
        />
      </div>
      <div
        className="sessions-view__handle"
        onMouseDown={onResizeHandleMouseDown}
      />
      <div className="sessions-chat__main">
        <div className="sessions-main__topbar">
          {splitMode === 'single' && selectedKey && (
            <span className="sessions-main__session-label">
              {selectedSession?.displayName || selectedSubAgent?.label || selectedKey}
            </span>
          )}
          <div className="sessions-main__topbar-spacer" />
          <div className="sessions-split-toolbar">
            {SPLIT_MODES.map(({ mode, icon: Icon, title }) => (
              <button
                key={mode}
                className={`sessions-split-btn${splitMode === mode ? ' sessions-split-btn--active' : ''}`}
                title={title}
                onClick={() => handleSplitModeChange(mode)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
        <SessionMainContent
          selectedHistoryId={selectedHistoryId}
          selectedLocalAgentPid={selectedLocalAgentPid}
          splitMode={splitMode}
          selectedKey={selectedKey}
          selectedSession={selectedSession ?? null}
          selectedSubAgent={selectedSubAgent}
          selectedUnifiedId={selectedUnifiedId}
          sessionMode={sessionMode}
          localSendPid={localSendPid}
        />
      </div>
      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </div>
  )
}
