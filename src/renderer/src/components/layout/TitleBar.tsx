import { Sun, Moon } from 'lucide-react'
import { useUIStore, type RepoFilter } from '../../stores/ui'
import { useThemeStore } from '../../stores/theme'
import { Badge } from '../ui/Badge'

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
  const repoFilter = useUIStore((s) => s.repoFilter)
  const setRepoFilter = useUIStore((s) => s.setRepoFilter)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

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

      <div className="titlebar__right">
        {sessionCount > 0 && (
          <Badge variant="success" size="sm">{sessionCount} active</Badge>
        )}
        <span className="titlebar__cost">${totalCost.toFixed(2)}</span>
        <button className="bde-btn bde-btn--icon bde-btn--sm" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  )
}
