import { Group, Panel, Separator } from 'react-resizable-panels'
import { TerminalPane } from './TerminalPane'
import { FindBar } from './FindBar'
import { AgentOutputTab } from './AgentOutputTab'
import type { TerminalTab } from '../../stores/terminal'

interface TerminalContentProps {
  tabs: TerminalTab[]
  activeTabId: string
  splitEnabled: boolean
  showFind: boolean
  isAgentTab: boolean
  activeView: string
}

export function TerminalContent({
  tabs,
  activeTabId,
  splitEnabled,
  showFind,
  isAgentTab,
  activeView
}: TerminalContentProps): React.JSX.Element {
  return (
    <div className="terminal-content">
      {!isAgentTab && showFind && <FindBar />}
      {tabs.map((tab) => {
        const isVisible = tab.id === activeTabId
        const paneClass = `terminal-content__pane${isVisible ? '' : ' terminal-content__pane--hidden'}`

        return (
          <div key={tab.id} className={paneClass}>
            {tab.kind === 'agent' && tab.agentId ? (
              <div className="terminal-content__agent-wrapper">
                <div className="terminal-agent-status-bar">
                  <span>{'\u{1F916}'} Agent Output</span>
                  {tab.agentSessionKey && (
                    <span className="terminal-content__agent-session-key">
                      {tab.agentSessionKey}
                    </span>
                  )}
                </div>
                <div className="terminal-content__agent-body">
                  <AgentOutputTab agentId={tab.agentId} />
                </div>
              </div>
            ) : splitEnabled && tab.id === activeTabId ? (
              <Group orientation="horizontal">
                <Panel defaultSize={50} minSize={20}>
                  <TerminalPane
                    tabId={tab.id}
                    shell={tab.shell}
                    visible={activeView === 'terminal'}
                  />
                </Panel>
                <Separator className="terminal-content__separator" />
                <Panel defaultSize={50} minSize={20}>
                  <TerminalPane
                    tabId={`${tab.id}-split`}
                    shell={tab.shell}
                    visible={activeView === 'terminal'}
                  />
                </Panel>
              </Group>
            ) : (
              <TerminalPane
                tabId={tab.id}
                shell={tab.shell}
                visible={activeView === 'terminal'}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
