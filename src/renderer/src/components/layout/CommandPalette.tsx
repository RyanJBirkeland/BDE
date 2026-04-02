import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { usePanelLayoutStore, findLeaf, type View } from '../../stores/panelLayout'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useAgentHistoryStore, type AgentMeta } from '../../stores/agentHistory'
import { toast } from '../../stores/toasts'
import { Kbd } from '../ui/Kbd'
import { timeAgo } from '../../lib/format'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'

type CommandCategory = 'navigation' | 'action' | 'panel' | 'session'

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
  panel: 'Panels',
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
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentAgents, setRecentAgents] = useState<AgentMeta[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  useFocusTrap(paletteRef, open)
  const setView = usePanelLayoutStore((s) => s.setView)
  const selectAgent = useAgentHistoryStore((s) => s.selectAgent)
  const { confirm, confirmProps } = useConfirm()

  // Fetch recent agents when palette opens
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('')
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const commands = useMemo<Command[]>(() => {
    const navCommands: { view: View; label: string; hint: string }[] = [
      { view: 'dashboard', label: 'Go to Dashboard', hint: '\u23181' },
      { view: 'agents', label: 'Go to Agents', hint: '\u23182' },
      { view: 'ide', label: 'Go to IDE', hint: '\u23183' },
      { view: 'sprint', label: 'Go to Task Pipeline', hint: '\u23184' },
      { view: 'code-review', label: 'Go to Code Review', hint: '\u23185' },
      { view: 'git', label: 'Go to Source Control', hint: '\u23186' },
      { view: 'settings', label: 'Go to Settings', hint: '\u23187' },
      { view: 'task-workbench', label: 'Go to Task Workbench', hint: '\u23180' }
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
        id: 'action-spawn-assistant',
        label: 'Launch BDE Assistant',
        category: 'action',
        hint: 'Interactive helper',
        action: async () => {
          onClose()
          try {
            const paths = await window.api.getRepoPaths()
            const repoPath = paths['BDE'] || paths[Object.keys(paths)[0]]
            if (!repoPath) {
              toast.error('No repo path found')
              return
            }
            await window.api.spawnLocalAgent({
              task: "You are now ready to assist. Wait for the user's first message.",
              repoPath,
              assistant: true
            })
            toast.success('BDE Assistant spawned')
            setView('agents')
          } catch (err) {
            toast.error(
              `Failed to spawn assistant: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          }
        }
      },
      {
        id: 'action-spawn-agent',
        label: 'Spawn Agent',
        category: 'action',
        hint: 'Open spawn modal',
        action: () => {
          setView('agents')
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

          const confirmed = await confirm({
            message: `Kill ${processes.length} running agent${processes.length > 1 ? 's' : ''}?`,
            variant: 'danger'
          })

          if (!confirmed) {
            return
          }

          try {
            await Promise.all(processes.map((p) => killLocalAgent(p.pid)))
            toast.success(`Killed ${processes.length} agent${processes.length > 1 ? 's' : ''}`)
          } catch (_error) {
            toast.error('Failed to kill some agents')
          }
          onClose()
        }
      }
    ]

    const panelCommands: Command[] = [
      {
        id: 'panel-split-right',
        label: 'Split Right',
        category: 'panel',
        hint: '\u2318\\',
        action: () => {
          const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
          if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal', 'agents')
          onClose()
        }
      },
      {
        id: 'panel-split-below',
        label: 'Split Below',
        category: 'panel',
        action: () => {
          const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
          if (focusedPanelId) splitPanel(focusedPanelId, 'vertical', 'agents')
          onClose()
        }
      },
      {
        id: 'panel-close',
        label: 'Close Panel',
        category: 'panel',
        hint: '\u2318W',
        action: () => {
          const { focusedPanelId, root, closeTab } = usePanelLayoutStore.getState()
          if (focusedPanelId) {
            const leaf = findLeaf(root, focusedPanelId)
            if (leaf) closeTab(focusedPanelId, leaf.activeTab)
          }
          onClose()
        }
      },
      {
        id: 'panel-reset',
        label: 'Reset Layout',
        category: 'panel',
        action: () => {
          usePanelLayoutStore.getState().resetLayout()
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
          setView('agents')
          selectAgent(agent.id)
          onClose()
        }
      }
    })

    return [...nav, ...actions, ...panelCommands, ...agentItems]
  }, [setView, onClose, selectAgent, recentAgents])

  const filtered = useMemo(() => {
    if (!query) return commands
    return commands.filter((cmd) => fuzzyMatch(query, cmd.label))
  }, [commands, query])

  // Group filtered items by category for rendering
  const groups = useMemo(() => {
    const order: CommandCategory[] = ['navigation', 'action', 'panel', 'session']
    return order
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        items: filtered.filter((cmd) => cmd.category === cat)
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  // Flat list for keyboard navigation + stable index lookup for rendering
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const g of groups) {
      for (const cmd of g.items) {
        map.set(cmd.id, idx++)
      }
    }
    return map
  }, [groups])

  const runSelected = useCallback(() => {
    if (flatItems[selectedIndex]) {
      flatItems[selectedIndex].action()
    }
  }, [flatItems, selectedIndex])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return (
    <AnimatePresence>
      {open && (
        <div className="command-palette__overlay elevation-3-backdrop" onClick={onClose}>
          <motion.div
            ref={paletteRef}
            className="command-palette glass-modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <input
              ref={inputRef}
              className="command-palette__input"
              type="text"
              placeholder="Type a command\u2026"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search commands"
            />
            <div className="command-palette__list" ref={listRef} role="listbox">
              {groups.map((group) => (
                <div key={group.category} className="command-palette__group">
                  <div className="command-palette__group-header">{group.label}</div>
                  {group.items.map((cmd) => {
                    const idx = flatIndexMap.get(cmd.id) ?? 0
                    return (
                      <button
                        key={cmd.id}
                        className={`command-palette__item ${idx === selectedIndex ? 'command-palette__item--selected' : ''}`}
                        role="option"
                        aria-selected={idx === selectedIndex}
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
      <ConfirmModal {...confirmProps} />
    </AnimatePresence>
  )
}
