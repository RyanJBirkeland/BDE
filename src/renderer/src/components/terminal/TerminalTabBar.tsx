import { useState } from 'react'
import { Plus, ChevronDown, X, Bot } from 'lucide-react'
import { ShellPicker } from './ShellPicker'
import { AgentPicker } from './AgentPicker'
import type { TerminalTab } from '../../stores/terminal'

interface TerminalTabBarProps {
  tabs: TerminalTab[]
  activeTabId: string
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onAddTab: (shell?: string) => void
  onCreateAgentTab: (agentId: string, label: string, sessionKey: string) => void
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onCreateAgentTab
}: TerminalTabBarProps): React.JSX.Element {
  const [showShellPicker, setShowShellPicker] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)

  return (
    <>
      <div className="terminal-tab-bar__tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isAgent = tab.kind === 'agent'
          const tabClass = [
            'terminal-tab',
            isActive && 'terminal-tab--active',
            isAgent && 'terminal-tab--agent'
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <div key={tab.id} className={tabClass} onClick={() => onSelectTab(tab.id)}>
              <span className="terminal-tab__title">
                {isAgent ? `\u{1F916} ${tab.title}` : tab.title}
              </span>
              {tabs.length > 1 && (
                <button
                  className="terminal-tab__close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}

        <div className="terminal-tab-bar__actions">
          <div className="terminal-tab-bar__btn-group">
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--add"
              onClick={() => onAddTab()}
              title="New terminal (⌘T)"
            >
              <Plus size={16} />
            </button>
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--shell"
              onClick={() => setShowShellPicker(!showShellPicker)}
              title="Choose shell"
            >
              <ChevronDown size={12} />
            </button>
            {showShellPicker && (
              <ShellPicker
                onSelect={(shell) => {
                  setShowShellPicker(false)
                  onAddTab(shell || undefined)
                }}
                onClose={() => setShowShellPicker(false)}
              />
            )}
          </div>

          <div className="terminal-tab-bar__btn-group">
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--agent"
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              title="Watch agent output"
            >
              <Bot size={16} />
            </button>
            {showAgentPicker && (
              <AgentPicker
                onSelect={(agentId, label) => {
                  setShowAgentPicker(false)
                  onCreateAgentTab(agentId, label, agentId)
                }}
                onClose={() => setShowAgentPicker(false)}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
