import './CommandPill.css'
import { Search } from 'lucide-react'
import { useCommandPaletteStore } from '../../stores/commandPalette'

export function CommandPill(): React.JSX.Element {
  const open = useCommandPaletteStore((s) => s.open)

  return (
    <button
      className="command-pill"
      onClick={open}
      aria-label="Search or run command"
      data-testid="command-pill"
    >
      <Search className="command-pill__icon" size={12} />
      <span className="command-pill__label">Search or run command…</span>
      <kbd className="command-pill__kbd">⌘K</kbd>
    </button>
  )
}
