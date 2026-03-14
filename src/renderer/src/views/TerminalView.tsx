import { Plus, X } from 'lucide-react'
import { TerminalPane } from '../components/terminal/TerminalPane'
import { tokens } from '../design-system/tokens'
import { useTerminalStore } from '../stores/terminal'

export function TerminalView(): React.JSX.Element {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab } = useTerminalStore()

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
          paddingLeft: tokens.space[2],
          gap: tokens.space[1],
          flexShrink: 0
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[1],
                padding: `${tokens.space[1]} ${tokens.space[3]}`,
                fontSize: tokens.size.sm,
                fontFamily: tokens.font.ui,
                color: isActive ? tokens.color.text : tokens.color.textMuted,
                background: isActive ? tokens.color.bg : 'transparent',
                borderBottom: isActive ? `2px solid ${tokens.color.accent}` : '2px solid transparent',
                cursor: 'pointer',
                userSelect: 'none',
                transition: tokens.transition.fast
              }}
            >
              <span>{tab.label}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: tokens.radius.sm,
                    color: tokens.color.textDim,
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
              )}
            </div>
          )
        })}

        {/* Add tab button */}
        <button
          onClick={addTab}
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
          <Plus size={16} />
        </button>
      </div>

      {/* Terminal panes — all mounted, only active is visible */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.id === activeTabId ? 'block' : 'none'
            }}
          >
            <TerminalPane tabId={tab.id} visible={tab.id === activeTabId} />
          </div>
        ))}
      </div>
    </div>
  )
}
