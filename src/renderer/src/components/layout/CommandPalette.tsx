import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore, type View } from '../../stores/ui'
import { useGatewayStore } from '../../stores/gateway'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useAgentHistoryStore, type AgentMeta } from '../../stores/agentHistory'
import { toast } from '../../stores/toasts'
import { Kbd } from '../ui/Kbd'
import { timeAgo } from '../../lib/format'
import { VARIANTS, SPRINGS } from '../../lib/motion'

type CommandCategory = 'navigation' | 'action' | 'session'

interface Command {
  id: string
  label: string
  category: CommandCategory
  hint?: string
  action: () => void
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigate',
  action: 'Agent Actions',
  session: 'Recent Agents'
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

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentAgents, setRecentAgents] = useState<AgentMeta[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const setView = useUIStore((s) => s.setView)
  const connect = useGatewayStore((s) => s.connect)
  const selectAgent = useAgentHistoryStore((s) => s.selectAgent)

  // Fetch recent agents when palette opens
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())

    const agents = useAgentHistoryStore.getState().agents
    setRecentAgents(agents.slice(0, 5))

    // Also try a fresh fetch
    useAgentHistoryStore
      .getState()
      .fetchAgents()
      .then(() => {
        setRecentAgents(useAgentHistoryStore.getState().agents.slice(0, 5))
      })
      .catch(() => {
        // ignore — we already have cached agents
      })
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const navCommands: { view: View; label: string; hint: string }[] = [
      { view: 'sessions', label: 'Go to Sessions', hint: '\u23181' },
      { view: 'terminal', label: 'Go to Terminal', hint: '\u23182' },
      { view: 'sprint', label: 'Go to Sprint', hint: '\u23183' },
      { view: 'diff', label: 'Go to Diff', hint: '\u23184' },
      { view: 'memory', label: 'Go to Memory', hint: '\u23185' },
      { view: 'cost', label: 'Go to Cost', hint: '\u23186' },
      { view: 'settings', label: 'Go to Settings', hint: '\u23187' }
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
        id: 'action-spawn-agent',
        label: 'Spawn Agent',
        category: 'action',
        hint: 'Open spawn modal',
        action: () => {
          setView('sessions')
          onClose()
          // Trigger spawn modal after navigation renders
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('bde:open-spawn-modal'))
          })
        }
      },
      {
        id: 'action-kill-all',
        label: 'Kill All',
        category: 'action',
        hint: 'Kill all running',
        action: async () => {
          const processes = useLocalAgentsStore.getState().processes
          const killLocalAgent = useLocalAgentsStore.getState().killLocalAgent

          if (processes.length === 0) {
            toast.info('No running agents to kill')
            onClose()
            return
          }

          try {
            await Promise.all(processes.map((p) => killLocalAgent(p.pid)))
            toast.success(`Killed ${processes.length} agent${processes.length > 1 ? 's' : ''}`)
          } catch (error) {
            toast.error('Failed to kill some agents')
          }
          onClose()
        }
      }
    ]

    const agentItems: Command[] = recentAgents.map((agent) => {
      return {
        id: `agent-${agent.id}`,
        label: `${agent.repo || agent.task.slice(0, 30)}`,
        category: 'session',
        hint: `${agent.model} ${timeAgo(agent.startedAt)}`,
        action: () => {
          setView('sessions')
          selectAgent(agent.id)
          onClose()
        }
      }
    })

    return [...nav, ...actions, ...agentItems]
  }, [setView, onClose, connect, selectAgent, recentAgents])

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

  let flatIndex = 0

  return (
    <AnimatePresence>
      {open && (
    <div className="command-palette__overlay elevation-3-backdrop" onClick={onClose}>
      <motion.div
        className="command-palette glass-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        variants={VARIANTS.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={SPRINGS.smooth}
      >
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
                    {cmd.hint && <Kbd>{cmd.hint}</Kbd>}
                  </button>
                )
              })}
            </div>
          ))}
          {flatItems.length === 0 && (
            <div className="command-palette__empty">No matching commands</div>
          )}
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  )
}
