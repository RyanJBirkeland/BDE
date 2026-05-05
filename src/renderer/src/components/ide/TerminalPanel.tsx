import { useCallback, useState } from 'react'
import { Columns2, Trash2, X, Maximize2 } from 'lucide-react'
import { IconBtn } from './IconBtn'
import { TerminalContent } from '../terminal/TerminalContent'
import { clearTerminal } from '../terminal/TerminalPane'
import { useTerminalStore } from '../../stores/terminal'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import type { TerminalTab } from '../../stores/terminal'

// ── TermTab ────────────────────────────────────────────────
// 24px inline tab for each terminal session. Agent-attached
// tabs receive a left accent stripe via box-shadow.

interface TermTabProps {
  tab: TerminalTab
  isActive: boolean
  canClose: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

function TermTab({ tab, isActive, canClose, onSelect, onClose }: TermTabProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const isAgent = tab.kind === 'agent'
  const isRunning = tab.status === 'running'

  const dotColor = isAgent ? 'var(--st-running)' : isRunning ? 'var(--st-running)' : 'var(--fg-3)'

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onSelect(tab.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        height: '100%',
        padding: '0 var(--s-2)',
        borderRight: '1px solid var(--line)',
        cursor: 'pointer',
        minWidth: 80,
        maxWidth: 160,
        flexShrink: 0,
        fontSize: 'var(--t-sm)',
        color: isActive ? 'var(--fg)' : hovered ? 'var(--fg-2)' : 'var(--fg-3)',
        background: isActive ? 'var(--bg)' : hovered ? 'var(--surf-2)' : 'transparent',
        // Left accent stripe for agent-attached tabs — inset to stay within element bounds
        boxShadow: isAgent ? 'inset 2px 0 0 var(--accent)' : 'none',
        transition: `background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)`,
        userSelect: 'none',
        outline: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Status dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '999px',
          background: dotColor,
          flexShrink: 0
        }}
      />

      {/* Label */}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {tab.title}
      </span>

      {/* Close glyph — hidden until hover or active */}
      {canClose && (
        <button
          aria-label={`Close ${tab.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onClose(tab.id)
          }}
          style={{
            width: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-3)',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
            opacity: hovered || isActive ? 1 : 0,
            transition: `opacity var(--dur-fast) var(--ease-out)`,
            borderRadius: 'var(--r-sm)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surf-3)'
            e.currentTarget.style.color = 'var(--fg)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--fg-3)'
          }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

// ── TerminalPanel ──────────────────────────────────────────
// V2 chrome wrapper for the terminal area. Replaces the V1
// TerminalTabBar + TerminalToolbar with a single 32px header
// row using V2 tokens. The xterm.js content area (TerminalContent)
// is untouched.

export function TerminalPanel(): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const closeTab = useTerminalStore((s) => s.closeTab)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const splitEnabled = useTerminalStore((s) => s.splitEnabled)
  const toggleSplit = useTerminalStore((s) => s.toggleSplit)
  const showFind = useTerminalStore((s) => s.showFind)
  const activeView = usePanelLayoutStore((s) => s.activeView)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isAgentTab = activeTab?.kind === 'agent'

  const handleClear = useCallback(() => {
    if (activeTabId && !isAgentTab) clearTerminal(activeTabId)
  }, [activeTabId, isAgentTab])

  // TODO(phase-6.5): implement kill terminal
  const handleKill = useCallback(() => {}, [])

  // TODO(phase-6.5): implement maximize terminal
  const handleMaximize = useCallback(() => {}, [])

  return (
    <div
      style={{
        borderTop: '1px solid var(--line)',
        background: 'var(--surf-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 140,
        maxHeight: 280,
        resize: 'vertical',
        overflow: 'hidden'
      }}
    >
      {/* 32px header: eyebrow | tab row | right icon buttons */}
      <div
        style={{
          height: 32,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
          background: 'var(--surf-1)'
        }}
      >
        {/* Eyebrow label */}
        <span
          className="fleet-eyebrow"
          style={{ padding: '0 var(--s-3)', flexShrink: 0, alignSelf: 'center' }}
        >
          TERMINAL
        </span>

        {/* Tab row — one per session, scrolls horizontally when full */}
        <div
          role="tablist"
          aria-label="Terminal tabs"
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'stretch',
            overflow: 'hidden',
            height: '100%'
          }}
        >
          {tabs.map((tab) => (
            <TermTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              canClose={tabs.length > 1}
              onSelect={setActiveTab}
              onClose={closeTab}
            />
          ))}
        </div>

        {/* Right icon buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--s-2)',
            gap: 'var(--s-1)',
            flexShrink: 0
          }}
        >
          <IconBtn
            icon={<Columns2 size={14} />}
            title={splitEnabled ? 'Close split (⌘⇧D)' : 'Split pane (⌘⇧D)'}
            active={splitEnabled}
            onClick={toggleSplit}
          />
          {!isAgentTab && (
            <IconBtn
              icon={<Trash2 size={14} />}
              title="Clear terminal (⌃L)"
              onClick={handleClear}
            />
          )}
          <IconBtn icon={<X size={14} />} title="Kill terminal" onClick={handleKill} />
          <IconBtn
            icon={<Maximize2 size={14} />}
            title="Maximize terminal"
            onClick={handleMaximize}
          />
        </div>
      </div>

      {/* xterm.js content — completely untouched */}
      <TerminalContent
        tabs={tabs}
        activeTabId={activeTabId}
        splitEnabled={splitEnabled}
        showFind={showFind}
        activeView={activeView}
      />
    </div>
  )
}
