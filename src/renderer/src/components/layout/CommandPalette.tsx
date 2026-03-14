import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUIStore, type View } from '../../stores/ui'

interface Command {
  id: string
  label: string
  category: 'view' | 'action'
  action: () => void
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const setView = useUIStore((s) => s.setView)

  const commands = useMemo<Command[]>(() => {
    const viewCommands: { view: View; label: string }[] = [
      { view: 'sessions', label: 'Sessions' },
      { view: 'sprint', label: 'Sprint / PRs' },
      { view: 'diff', label: 'Diff' },
      { view: 'memory', label: 'Memory' },
      { view: 'settings', label: 'Settings' }
    ]

    return [
      ...viewCommands.map((v) => ({
        id: `view-${v.view}`,
        label: v.label,
        category: 'view' as const,
        action: () => {
          setView(v.view)
          onClose()
        }
      })),
      {
        id: 'action-spawn',
        label: 'Spawn agent',
        category: 'action',
        action: () => onClose()
      },
      {
        id: 'action-refresh',
        label: 'Refresh sessions',
        category: 'action',
        action: () => onClose()
      },
      {
        id: 'action-github',
        label: 'Open GitHub',
        category: 'action',
        action: () => onClose()
      }
    ]
  }, [setView, onClose])

  const filtered = useMemo(() => {
    if (!query) return commands
    return commands.filter((cmd) => fuzzyMatch(query, cmd.label))
  }, [commands, query])

  const runSelected = useCallback(() => {
    if (filtered[selectedIndex]) {
      filtered[selectedIndex].action()
    }
  }, [filtered, selectedIndex])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        runSelected()
      }
    },
    [onClose, filtered.length, runSelected]
  )

  if (!open) return null

  return (
    <div className="command-palette__overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="command-palette__list">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`command-palette__item ${i === selectedIndex ? 'command-palette__item--selected' : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette__label">{cmd.label}</span>
              <span className="command-palette__category">{cmd.category}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="command-palette__empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}
