import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown, X, SplitSquareVertical } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { TerminalPane, clearTerminal } from '../components/terminal/TerminalPane'
import { FindBar } from '../components/terminal/FindBar'
import { ShellPicker } from '../components/terminal/ShellPicker'
import { AgentOutputTab } from '../components/terminal/AgentOutputTab'
import { tokens } from '../design-system/tokens'
import { useTerminalStore } from '../stores/terminal'
import { useUIStore } from '../stores/ui'
import { POLL_PROCESSES_INTERVAL } from '../lib/constants'

/** Extract exec/bash tool outputs from session history entries */
function extractExecResults(history: any[]): string[] {
  const results: string[] = []
  for (const entry of history) {
    if (entry?.tool === 'exec' || entry?.tool === 'bash' || entry?.tool === 'Bash') {
      const output = entry.result?.output ?? entry.result?.stdout ?? entry.output ?? ''
      if (output) results.push(String(output))
    }
  }
  return results
}

export function TerminalView(): React.JSX.Element {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, splitEnabled, toggleSplit, showFind } = useTerminalStore()
  const activeView = useUIStore((s) => s.activeView)
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [showShellPicker, setShowShellPicker] = useState(false)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isAgentTab = activeTab?.kind === 'agent'

  const handleClear = useCallback(() => {
    if (activeTabId && !isAgentTab) clearTerminal(activeTabId)
  }, [activeTabId, isAgentTab])

  // Keyboard shortcuts — capture phase so they fire before App.tsx global handler
  useEffect(() => {
    if (activeView !== 'terminal') return

    const handler = (e: KeyboardEvent): void => {
      if (!e.metaKey) return

      if (e.key === 't') {
        e.preventDefault()
        e.stopPropagation()
        useTerminalStore.getState().addTab()
        return
      }

      if (e.key === 'w') {
        e.preventDefault()
        e.stopPropagation()
        const { activeTabId: id } = useTerminalStore.getState()
        if (id) useTerminalStore.getState().closeTab(id)
        return
      }

      if (e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        const { activeTabId: id } = useTerminalStore.getState()
        if (id) clearTerminal(id)
        return
      }

      if (e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        const store = useTerminalStore.getState()
        const currentTab = store.tabs.find((t) => t.id === store.activeTabId)
        // Only show find bar for shell tabs
        if (currentTab?.kind === 'shell') {
          store.setShowFind(!store.showFind)
        }
        return
      }

      if (e.shiftKey && e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        useTerminalStore.getState().toggleSplit()
        return
      }

      // Cmd+1-9: switch to tab N
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        const { tabs: currentTabs } = useTerminalStore.getState()
        if (idx < currentTabs.length) {
          e.preventDefault()
          e.stopPropagation()
          useTerminalStore.getState().setActiveTab(currentTabs[idx].id)
        }
        return
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeView])

  // Poll agent session history every 5s for the active agent tab
  const [agentOutput, setAgentOutput] = useState<string[]>([])
  const lastSeenCountRef = useRef(0)

  useEffect(() => {
    if (!activeTab?.isAgentTab || !activeTab.agentSessionKey) {
      setAgentOutput([])
      lastSeenCountRef.current = 0
      return
    }

    const sessionKey = activeTab.agentSessionKey
    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const history = await window.api.getSessionHistory(sessionKey)
        if (cancelled) return
        const results = extractExecResults(history)
        if (results.length > lastSeenCountRef.current) {
          lastSeenCountRef.current = results.length
          setAgentOutput(results)
        }
      } catch {
        // Silently ignore poll errors
      }
    }

    poll()
    const interval = setInterval(poll, POLL_PROCESSES_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeTab?.id, activeTab?.isAgentTab, activeTab?.agentSessionKey])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.color.bg }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: tokens.color.surface,
          borderBottom: `1px solid ${tokens.color.border}`,
          minHeight: 36,
          flexShrink: 0
        }}
      >
        {/* Scrollable tabs region */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1],
            paddingLeft: tokens.space[2],
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
            scrollbarWidth: 'none'
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            const isHovered = tab.id === hoveredTabId
            const showClose = tabs.length > 1 && (isActive || isHovered)
            const isAgent = tab.isAgentTab
            const displayTitle = isAgent ? `\u{1F916} ${tab.title}` : tab.title
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onMouseEnter={() => setHoveredTabId(tab.id)}
                onMouseLeave={() => setHoveredTabId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[2],
                  padding: `0 ${tokens.space[4]}`,
                  minWidth: 120,
                  height: 36,
                  fontSize: tokens.size.sm,
                  fontFamily: tokens.font.ui,
                  fontStyle: isAgent ? 'italic' : 'normal',
                  color: isActive ? tokens.color.text : tokens.color.textMuted,
                  background: isActive ? tokens.color.bg : 'transparent',
                  borderBottom: isActive
                    ? `2px solid ${isAgent ? '#a78bfa' : tokens.color.accent}`
                    : '2px solid transparent',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: tokens.transition.fast
                }}
              >
                {/* Purple status dot for agent tabs */}
                {isAgent && (
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#a78bfa',
                    flexShrink: 0
                  }} />
                )}
                <span style={{ flex: 1 }}>{displayTitle}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    borderRadius: tokens.radius.sm,
                    color: tokens.color.textDim,
                    flexShrink: 0,
                    opacity: showClose ? 1 : 0,
                    pointerEvents: showClose ? 'auto' : 'none',
                    transition: tokens.transition.fast
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = tokens.color.text
                    e.currentTarget.style.background = tokens.color.surfaceHigh
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = tokens.color.textDim
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <X size={12} />
                </span>
              </div>
            )
          })}

          {/* Add tab [+] and shell picker [▾] */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
            <button
              onClick={() => addTab()}
              title="New terminal (⌘T)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: tokens.color.textMuted,
                cursor: 'pointer',
                borderRadius: `${tokens.radius.sm} 0 0 ${tokens.radius.sm}`,
                transition: tokens.transition.fast
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = tokens.color.text
                e.currentTarget.style.background = tokens.color.surfaceHigh
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = tokens.color.textMuted
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Plus size={16} />
            </button>
            <button
              onClick={() => setShowShellPicker(!showShellPicker)}
              title="Choose shell"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: tokens.color.textMuted,
                cursor: 'pointer',
                borderRadius: `0 ${tokens.radius.sm} ${tokens.radius.sm} 0`,
                transition: tokens.transition.fast
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = tokens.color.text
                e.currentTarget.style.background = tokens.color.surfaceHigh
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = tokens.color.textMuted
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <ChevronDown size={12} />
            </button>
            {showShellPicker && (
              <ShellPicker
                onSelect={(shell) => {
                  setShowShellPicker(false)
                  addTab(shell || undefined)
                }}
                onClose={() => setShowShellPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Toolbar — right side */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1],
            paddingRight: tokens.space[2],
            paddingLeft: tokens.space[2],
            flexShrink: 0
          }}
        >
          {/* Clear button — only show for shell tabs */}
          {!isAgentTab && (
            <button
              onClick={handleClear}
              title="Clear terminal"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: tokens.space[1],
                height: 26,
                padding: `0 ${tokens.space[2]}`,
                border: 'none',
                background: 'transparent',
                color: tokens.color.textMuted,
                fontSize: tokens.size.xs,
                fontFamily: tokens.font.ui,
                cursor: 'pointer',
                borderRadius: tokens.radius.sm,
                transition: tokens.transition.fast
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = tokens.color.text
                e.currentTarget.style.background = tokens.color.surfaceHigh
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = tokens.color.textMuted
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ userSelect: 'none' }}>⌘K</span>
            </button>
          )}

          {/* Split button */}
          <button
            onClick={toggleSplit}
            title={splitEnabled ? 'Close split (⌘⇧D)' : 'Split pane (⌘⇧D)'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              border: 'none',
              background: splitEnabled ? tokens.color.surfaceHigh : 'transparent',
              color: splitEnabled ? tokens.color.accent : tokens.color.textMuted,
              cursor: 'pointer',
              borderRadius: tokens.radius.sm,
              transition: tokens.transition.fast
            }}
            onMouseEnter={(e) => {
              if (!splitEnabled) {
                e.currentTarget.style.color = tokens.color.text
                e.currentTarget.style.background = tokens.color.surfaceHigh
              }
            }}
            onMouseLeave={(e) => {
              if (!splitEnabled) {
                e.currentTarget.style.color = tokens.color.textMuted
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <SplitSquareVertical size={14} />
          </button>
        </div>
      </div>

      {/* Terminal panes — all mounted, only active is visible */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Find bar — only show for shell tabs */}
        {!isAgentTab && showFind && <FindBar />}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.id === activeTabId ? 'block' : 'none'
            }}
          >
            {tab.kind === 'agent' && tab.agentId ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Agent status bar */}
                <div className="terminal-agent-status-bar">
                  <span>{'\u{1F916}'} Agent Output</span>
                  {tab.agentSessionKey && (
                    <span style={{ color: tokens.color.textDim, fontSize: tokens.size.xs }}>
                      {tab.agentSessionKey}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <AgentOutputTab agentId={tab.agentId} agentOutput={agentOutput} />
                </div>
              </div>
            ) : splitEnabled && tab.id === activeTabId ? (
              <Group orientation="horizontal">
                <Panel defaultSize={50} minSize={20}>
                  <TerminalPane tabId={tab.id} shell={tab.shell} visible={activeView === 'terminal'} />
                </Panel>
                <Separator
                  style={{
                    width: 4,
                    background: tokens.color.border,
                    cursor: 'col-resize',
                    transition: tokens.transition.fast,
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = tokens.color.accent
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = tokens.color.border
                  }}
                />
                <Panel defaultSize={50} minSize={20}>
                  <TerminalPane tabId={`${tab.id}-split`} shell={tab.shell} visible={activeView === 'terminal'} />
                </Panel>
              </Group>
            ) : (
              <TerminalPane tabId={tab.id} shell={tab.shell} visible={activeView === 'terminal'} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
