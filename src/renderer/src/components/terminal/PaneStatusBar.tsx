import { useState } from 'react'
import type { TerminalTab } from '../../stores/terminal'

interface PaneStatusBarProps {
  tab: TerminalTab
  cols: number
  rows: number
}

export function PaneStatusBar({ tab, cols, rows }: PaneStatusBarProps): React.JSX.Element {
  const [cwd] = useState('~')

  // TODO: Implement CWD polling when terminal:getCwd IPC handler is added
  // useEffect(() => {
  //   if (!tab.ptyId) return
  //   const interval = setInterval(async () => {
  //     try {
  //       const result = await window.api.terminal.getCwd({ ptyId: tab.ptyId! })
  //       if (result) setCwd(result)
  //     } catch (err) {
  //       // Ignore errors — PTY might be closed
  //     }
  //   }, 3000)
  //   return () => clearInterval(interval)
  // }, [tab.ptyId])

  const shellName =
    tab.kind === 'agent' ? '🤖 Agent Output' : tab.shell?.split('/').pop() || 'shell'

  return (
    <div className="terminal-pane-status">
      <span className="terminal-pane-status__shell">{shellName}</span>
      <span className="terminal-pane-status__separator">•</span>
      <span className="terminal-pane-status__cwd">{cwd}</span>
      <span className="terminal-pane-status__separator">•</span>
      <span className="terminal-pane-status__dimensions">
        {cols}×{rows}
      </span>
    </div>
  )
}
