import { useUIStore, type RepoFilter, type View } from '../../stores/ui'

const VIEW_LABELS: Record<View, string> = {
  sessions: 'Sessions',
  sprint: 'Sprint / PRs',
  diff: 'Diff',
  memory: 'Memory',
  cost: 'Cost Tracker',
  settings: 'Settings'
}

const REPO_OPTIONS: { value: RepoFilter; label: string }[] = [
  { value: 'all', label: 'all repos' },
  { value: 'life-os', label: 'life-os' },
  { value: 'feast', label: 'feast' }
]

interface TitleBarProps {
  sessionCount: number
  totalCost: number
}

export function TitleBar({ sessionCount, totalCost }: TitleBarProps): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)
  const repoFilter = useUIStore((s) => s.repoFilter)
  const setRepoFilter = useUIStore((s) => s.setRepoFilter)

  return (
    <div className="titlebar">
      <div className="titlebar__left">
        <select
          className="titlebar__repo-select"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value as RepoFilter)}
        >
          {REPO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="titlebar__center">
        <span className="titlebar__view-name">{VIEW_LABELS[activeView]}</span>
      </div>

      <div className="titlebar__right">
        {sessionCount > 0 && (
          <span className="titlebar__badge">{sessionCount} active</span>
        )}
        <span className="titlebar__cost">${totalCost.toFixed(2)}</span>
      </div>
    </div>
  )
}
