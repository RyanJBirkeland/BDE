import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUIStore, type View } from '../../stores/ui'
import { useGatewayStore } from '../../stores/gateway'
import { useSessionsStore, type AgentSession } from '../../stores/sessions'
import { toast } from '../../stores/toasts'

type CommandCategory = 'navigation' | 'action' | 'session'

interface Command {
  id: string
  label: string
  category: CommandCategory
  hint?: string
  action: () => void
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  action: 'Actions',
  session: 'Recent Sessions'
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
  const [recentSessions, setRecentSessions] = useState<AgentSession[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const setView = useUIStore((s) => s.setView)
  const connect = useGatewayStore((s) => s.connect)
  const selectSession = useSessionsStore((s) => s.selectSession)

  // Fetch recent sessions when palette opens
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())

    const sessions = useSessionsStore.getState().sessions
    setRecentSessions(sessions.slice(0, 5))

    // Also try a fresh fetch
    useSessionsStore
      .getState()
      .fetchSessions()
      .then(() => {
        setRecentSessions(useSessionsStore.getState().sessions.slice(0, 5))
      })
      .catch(() => {
        // ignore — we already have cached sessions
      })
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const navCommands: { view: View; label: string; hint: string }[] = [
      { view: 'sessions', label: 'Go to Sessions', hint: '\u23181' },
      { view: 'sprint', label: 'Go to Sprint', hint: '\u23182' },
      { view: 'diff', label: 'Go to Diff', hint: '\u23183' },
      { view: 'memory', label: 'Go to Memory', hint: '\u23184' },
      { view: 'cost', label: 'Go to Cost', hint: '\u23185' },
      { view: 'settings', label: 'Go to Settings', hint: '\u23186' }
    ]

    const nav: Command[] = navCommands.map((v) => ({
      id: `nav-${v.view}`,
      label: v.label,
      category: 'navigation',
      hint: v.hint,
      action: () => {
        setView(v.view)
        onClose()
      }
    }))

    const actions: Command[] = [
      {
        id: 'action-reconnect',
        label: 'Reconnect Gateway',
        category: 'action',
        action: () => {
          connect()
          toast.info('Reconnecting to gateway\u2026')
          onClose()
        }
      },
      {
        id: 'action-refresh',
        label: 'Refresh',
        category: 'action',
        hint: '\u2318R',
        action: () => {
          window.dispatchEvent(new CustomEvent('bde:refresh'))
          toast.info('Refreshing\u2026')
          onClose()
        }
      },
      {
        id: 'action-new-task',
        label: 'New Agent Task',
        category: 'action',
        action: () => {
          setView('sessions')
          onClose()
          // Focus the task input after navigation renders
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('bde:focus-task-input'))
          })
        }
      },
      {
        id: 'action-github',
        label: 'Open GitHub',
        category: 'action',
        action: () => {
          window.api.openExternal('https://github.com/RyanJBirkeland/BDE')
          onClose()
        }
      }
    ]

    const sessionItems: Command[] = recentSessions.map((s) => ({
      id: `session-${s.key}`,
      label: s.label || s.key,
      category: 'session',
      action: () => {
        setView('sessions')
        selectSession(s.key)
        onClose()
      }
    }))

    return [...nav, ...actions, ...sessionItems]
  }, [setView, onClose, connect, selectSession, recentSessions])

  const filtered = useMemo(() => {
    if (!query) return commands
    return commands.filter((cmd) => fuzzyMatch(query, cmd.label))
  }, [commands, query])

  // Group filtered items by category for rendering
  const groups = useMemo(() => {
    const order: CommandCategory[] = ['navigation', 'action', 'session']
    return order
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        items: filtered.filter((cmd) => cmd.category === cat)
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const runSelected = useCallback(() => {
    if (flatItems[selectedIndex]) {
      flatItems[selectedIndex].action()
    }
  }, [flatItems, selectedIndex])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('.command-palette__item--selected')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        runSelected()
      }
    },
    [onClose, flatItems.length, runSelected]
  )

  if (!open) return null

  let flatIndex = 0

  return (
    <div className="command-palette__overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          placeholder="Type a command\u2026"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="command-palette__list" ref={listRef}>
          {groups.map((group) => (
            <div key={group.category} className="command-palette__group">
              <div className="command-palette__group-header">{group.label}</div>
              {group.items.map((cmd) => {
                const idx = flatIndex++
                return (
                  <button
                    key={cmd.id}
                    className={`command-palette__item ${idx === selectedIndex ? 'command-palette__item--selected' : ''}`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="command-palette__label">{cmd.label}</span>
                    {cmd.hint && <kbd className="command-palette__hint">{cmd.hint}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
          {flatItems.length === 0 && (
            <div className="command-palette__empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}
