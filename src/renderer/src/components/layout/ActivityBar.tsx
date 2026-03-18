import {
  Terminal,
  SquareTerminal,
  GitBranch,
  GitCompare,
  GitPullRequest,
  Brain,
  DollarSign,
  Settings
} from 'lucide-react'
import { useUIStore, View } from '../../stores/ui'

const NAV_ITEMS: { view: View; icon: typeof Terminal; label: string; shortcut: string }[] = [
  { view: 'sessions', icon: Terminal, label: 'Sessions', shortcut: '⌘1' },
  { view: 'terminal', icon: SquareTerminal, label: 'Terminal', shortcut: '⌘2' },
  { view: 'sprint', icon: GitBranch, label: 'Sprint / PRs', shortcut: '⌘3' },
  { view: 'diff', icon: GitCompare, label: 'Diff', shortcut: '⌘4' },
  { view: 'pr-station', icon: GitPullRequest, label: 'PR Station', shortcut: '⌘5' },
  { view: 'memory', icon: Brain, label: 'Memory', shortcut: '⌘6' },
  { view: 'cost', icon: DollarSign, label: 'Cost Tracker', shortcut: '⌘7' },
  { view: 'settings', icon: Settings, label: 'Settings', shortcut: '⌘8' }
]

interface ActivityBarProps {
  connectionStatus: string
}

export function ActivityBar({ connectionStatus }: ActivityBarProps): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)
  const setView = useUIStore((s) => s.setView)

  const isConnected = connectionStatus === 'connected'

  return (
    <div className="activity-bar">
      <div className="activity-bar__nav">
        {NAV_ITEMS.map(({ view, icon: Icon, label, shortcut }) => (
          <button
            key={view}
            className={'activity-bar__item ' + (activeView === view ? 'activity-bar__item--active' : '')}
            onClick={() => setView(view)}
            title={label + ' (' + shortcut + ')'}
          >
            <Icon size={18} strokeWidth={1.5} />
            <span className="activity-bar__item-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="activity-bar__bottom">
        <div
          className={'activity-bar__status ' + (isConnected ? 'activity-bar__status--connected' : 'activity-bar__status--disconnected')}
          title={isConnected ? 'Connected to gateway' : 'Disconnected from gateway'}
        />
      </div>
    </div>
  )
}
