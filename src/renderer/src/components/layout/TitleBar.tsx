import { Sun, Moon } from 'lucide-react'
import { useThemeStore } from '../../stores/theme'
import { Badge } from '../ui/Badge'

interface TitleBarProps {
  sessionCount: number
  totalCost: number
}

export function TitleBar({ sessionCount, totalCost }: TitleBarProps): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  return (
    <div className="titlebar glass">
      <div className="titlebar__left">
        <span className="titlebar__logotype-wrapper">
          <span className="logotype-glow" aria-hidden>BDE</span>
          <span className="logotype">BDE</span>
        </span>
        <div className="titlebar__separator" />
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
