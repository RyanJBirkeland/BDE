import { SplitSquareVertical } from 'lucide-react'

interface TerminalToolbarProps {
  isAgentTab: boolean
  splitEnabled: boolean
  onClear: () => void
  onToggleSplit: () => void
}

export function TerminalToolbar({
  isAgentTab,
  splitEnabled,
  onClear,
  onToggleSplit
}: TerminalToolbarProps): React.JSX.Element {
  return (
    <div className="terminal-toolbar">
      {!isAgentTab && (
        <button className="terminal-toolbar__btn" onClick={onClear} title="Clear terminal">
          <span className="terminal-toolbar__kbd">⌘K</span>
        </button>
      )}

      <button
        className={`terminal-toolbar__btn terminal-toolbar__btn--icon${splitEnabled ? ' terminal-toolbar__btn--active' : ''}`}
        onClick={onToggleSplit}
        title={splitEnabled ? 'Close split (⌘⇧D)' : 'Split pane (⌘⇧D)'}
      >
        <SplitSquareVertical size={14} />
      </button>
    </div>
  )
}
