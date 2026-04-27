import './CommandPalette.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { usePanelLayoutStore, findLeaf, type View } from '../../stores/panelLayout'
import { useAgentHistoryStore, type AgentMeta } from '../../stores/agentHistory'
import { toast } from '../../stores/toasts'
import { Kbd } from '../ui/Kbd'
import { timeAgo } from '../../lib/format'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import {
  useCommandPaletteStore,
  type CommandCategory,
  type Command
} from '../../stores/commandPalette'
import { useKeybindingsStore } from '../../stores/keybindings'

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigate',
  task: 'Tasks',
  review: 'Code Review',
  filter: 'Filters',
  settings: 'Settings',
  action: 'Agent Actions',
  panel: 'Panels',
  session: 'Recent Agents',
  help: 'Help'
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
  const { confirmProps } = useConfirm()

  // Command registry hooks
  const registeredCommands = useCommandPaletteStore((s) => s.commands)
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)
  const fuzzySearch = useCommandPaletteStore((s) => s.fuzzySearch)
  const trackCommandUsage = useCommandPaletteStore((s) => s.trackCommandUsage)

  // Register core commands on mount (commands capture setView/onClose from closure)
  useEffect(() => {
    const bindings = useKeybindingsStore.getState().bindings

    const navCommands: { view: View; label: string; actionId: keyof typeof bindings }[] = [
      { view: 'dashboard', label: 'Go to Dashboard', actionId: 'view.dashboard' },
      { view: 'agents', label: 'Go to Agents', actionId: 'view.agents' },
      { view: 'ide', label: 'Go to IDE', actionId: 'view.ide' },
      { view: 'sprint', label: 'Go to Task Pipeline', actionId: 'view.sprint' },
      { view: 'code-review', label: 'Go to Code Review', actionId: 'view.codeReview' },
      { view: 'git', label: 'Go to Source Control', actionId: 'view.git' },
      { view: 'settings', label: 'Go to Settings', actionId: 'view.settings' },
      { view: 'planner', label: 'Go to Task Planner', actionId: 'view.planner' }
    ]

    const nav: Command[] = navCommands.map((v) => ({
      id: `nav-${v.view}`,
      label: v.label,
      category: 'navigation',
      hint: bindings[v.actionId],
      keywords: [v.view, 'goto', 'open'],
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
        keywords: ['assistant', 'help', 'agent', 'spawn'],
        action: async () => {
          onClose()
          try {
            const paths = await window.api.git.getRepoPaths()
            const firstKey = Object.keys(paths)[0]
            const repoPath = firstKey ? paths[firstKey] : undefined
            if (!repoPath) {
              toast.error('No repo path found')
              return
            }
            await window.api.agents.spawnLocal({
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
        keywords: ['agent', 'spawn', 'adhoc'],
        action: () => {
          setView('agents')
          onClose()
          // Trigger spawn modal after navigation renders
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('bde:open-spawn-modal'))
          })
        }
      }
    ]

    const panelCommands: Command[] = [
      {
        id: 'panel-split-right',
        label: 'Split Right',
        category: 'panel',
        hint: bindings['panel.splitRight'],
        keywords: ['split', 'horizontal', 'panel'],
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
        keywords: ['split', 'vertical', 'panel'],
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
        hint: bindings['panel.closeTab'],
        keywords: ['close', 'panel', 'tab'],
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
        keywords: ['reset', 'layout', 'default'],
        action: () => {
          usePanelLayoutStore.getState().resetLayout()
          onClose()
        }
      }
    ]

    const helpCommands: Command[] = [
      {
        id: 'help-feature-guide',
        label: 'Feature Guide',
        category: 'help',
        hint: 'View guide',
        keywords: ['help', 'guide', 'features', 'views', 'learn'],
        action: () => {
          onClose()
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('bde:open-feature-guide'))
          })
        }
      }
    ]

    const coreCommands = [...nav, ...actions, ...panelCommands, ...helpCommands]
    registerCommands(coreCommands)

    return () => {
      unregisterCommands(coreCommands.map((c) => c.id))
    }
    // Commands capture setView/onClose from closure - only register once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Combine registered commands with dynamic session commands
  const commands = useMemo<Command[]>(() => {
    const agentItems: Command[] = recentAgents.map((agent) => ({
      id: `agent-${agent.id}`,
      label: `${agent.repo || agent.task.slice(0, 30)}`,
      category: 'session' as CommandCategory,
      hint: `${agent.model} ${timeAgo(agent.startedAt)}`,
      keywords: ['agent', 'session', 'recent'],
      action: () => {
        setView('agents')
        selectAgent(agent.id)
        onClose()
      }
    }))

    return [...registeredCommands, ...agentItems]
    // recentAgents changes frequently, registeredCommands is stable
    // setView/selectAgent/onClose captured from closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registeredCommands, recentAgents])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    return fuzzySearch(query, commands)
  }, [commands, query, fuzzySearch])

  // Group filtered items by category for rendering
  const groups = useMemo(() => {
    const order: CommandCategory[] = [
      'navigation',
      'task',
      'review',
      'filter',
      'settings',
      'action',
      'panel',
      'help',
      'session'
    ]
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
    const cmd = flatItems[selectedIndex]
    if (cmd) {
      trackCommandUsage(cmd.id)
      cmd.action()
    }
  }, [flatItems, selectedIndex, trackCommandUsage])

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
                        onClick={() => {
                          trackCommandUsage(cmd.id)
                          cmd.action()
                        }}
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
