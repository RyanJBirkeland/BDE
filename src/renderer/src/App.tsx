import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGatewayStore } from './stores/gateway'
import { useUIStore, type View } from './stores/ui'
import { useSessionsStore } from './stores/sessions'
import { useCommandPaletteStore } from './stores/commandPalette'
import { useCostDataStore } from './stores/costData'
import { ActivityBar } from './components/layout/ActivityBar'
import { TitleBar } from './components/layout/TitleBar'
import { StatusBar } from './components/layout/StatusBar'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/layout/ToastContainer'
import { Button } from './components/ui/Button'
import { Kbd } from './components/ui/Kbd'
import { useAgentHistoryStore } from './stores/agentHistory'
import { useTaskNotifications } from './hooks/useTaskNotifications'
import { useGitHubRateLimitWarning } from './hooks/useGitHubRateLimitWarning'
import { PanelRenderer } from './components/panels/PanelRenderer'
import { usePanelLayoutStore, findLeaf } from './stores/panelLayout'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from './lib/motion'
import { DEFAULT_MODEL } from '../../shared/models'

const VIEW_ORDER: View[] = [
  'agents',
  'terminal',
  'sprint',
  'pr-station',
  'memory',
  'cost',
  'settings'
]

const VIEW_TITLES: Record<View, string> = {
  agents: 'Agents',
  terminal: 'Terminal',
  sprint: 'Planning',
  'pr-station': 'PR Station',
  memory: 'Memory',
  cost: 'Cost',
  settings: 'Settings'
}

const SHORTCUTS_LEFT: { keys: string; description: string }[] = [
  { keys: '\u23181\u20137', description: 'Switch views' },
  { keys: '\u2318P', description: 'Command palette' },
  { keys: '\u2318R', description: 'Refresh current view' },
  { keys: 'Escape', description: 'Close panel / blur input' },
  { keys: '?', description: 'Show shortcuts' }
]

const SHORTCUTS_RIGHT: { keys: string; description: string }[] = [
  { keys: '\u2191 / \u2193', description: 'Navigate list items' },
  { keys: 'Enter', description: 'Select / open item' },
  { keys: 'PageUp / Down', description: 'Scroll chat thread' },
  { keys: 'End', description: 'Jump to latest message' },
  { keys: '[ / ]', description: 'Prev / next diff file' }
]


function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  const reduced = useReducedMotion()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="shortcuts-overlay elevation-3-backdrop" onClick={onClose}>
      <motion.div
        className="shortcuts-overlay__panel glass-modal"
        onClick={(e) => e.stopPropagation()}
        variants={VARIANTS.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <h2 className="shortcuts-overlay__title">Keyboard Shortcuts</h2>
        <div className="shortcuts-overlay__columns">
          <div className="shortcuts-overlay__col">
            <div className="shortcuts-overlay__col-title">Global</div>
            {SHORTCUTS_LEFT.map((s) => (
              <div key={s.keys} className="shortcuts-overlay__row">
                <Kbd>{s.keys}</Kbd>
                <span>{s.description}</span>
              </div>
            ))}
          </div>
          <div className="shortcuts-overlay__col">
            <div className="shortcuts-overlay__col-title">Navigation</div>
            {SHORTCUTS_RIGHT.map((s) => (
              <div key={s.keys} className="shortcuts-overlay__row">
                <Kbd>{s.keys}</Kbd>
                <span>{s.description}</span>
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" className="shortcuts-overlay__close" onClick={onClose}>
          Close <Kbd>Esc</Kbd>
        </Button>
      </motion.div>
    </div>
  )
}

function App(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const connect = useGatewayStore((s) => s.connect)
  const activeView = useUIStore((s) => s.activeView)
  const setView = useUIStore((s) => s.setView)
  const root = usePanelLayoutStore((s) => s.root)
  const runningCount = useSessionsStore((s) => s.runningCount)
  const totalCost = useCostDataStore((s) => s.totalCost)
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const loadLayout = usePanelLayoutStore((s) => s.loadSavedLayout)

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useEffect(() => {
    loadLayout()
  }, [loadLayout])

  useTaskNotifications()
  useGitHubRateLimitWarning()

  useEffect(() => {
    const title = 'BDE \u2014 ' + VIEW_TITLES[activeView]
    document.title = title
    window.api.setTitle(title)
  }, [activeView])

  useEffect(() => {
    const handler = (e: CustomEvent): void => {
      const { view, sessionId } = e.detail
      if (view === 'agents') {
        setView('agents')
        if (sessionId) {
          useAgentHistoryStore.getState().selectAgent(sessionId)
        }
      }
    }
    window.addEventListener('bde:navigate', handler as EventListener)
    return () => window.removeEventListener('bde:navigate', handler as EventListener)
  }, [setView])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        e.preventDefault()
        if (paletteOpen) { closePalette(); return }
        if (shortcutsOpen) { setShortcutsOpen(false); return }
        if (inInput) { (document.activeElement as HTMLElement)?.blur(); return }
        window.dispatchEvent(new CustomEvent('bde:escape'))
        return
      }

      if (inInput && !e.metaKey) return

      if (e.metaKey && e.key >= '1' && e.key <= '7') {
        e.preventDefault()
        setView(VIEW_ORDER[Number(e.key) - 1])
        return
      }

      // Cmd+\ — Split focused panel right
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
        if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal', 'agents')
        return
      }

      // Cmd+W — Close focused panel's active tab
      if (e.metaKey && e.key === 'w') {
        e.preventDefault()
        const { focusedPanelId, root } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf) usePanelLayoutStore.getState().closeTab(focusedPanelId, leaf.activeTab)
        }
        return
      }

      // Cmd+Shift+[ / ] — Cycle tabs within focused panel
      if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        const { focusedPanelId, root, setActiveTab } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf && leaf.tabs.length > 1) {
            const delta = e.key === ']' ? 1 : -1
            const next = (leaf.activeTab + delta + leaf.tabs.length) % leaf.tabs.length
            setActiveTab(focusedPanelId, next)
          }
        }
        return
      }

      if (e.metaKey && e.key === 'p') {
        e.preventDefault()
        togglePalette()
        return
      }

      if (e.metaKey && e.key === 'r') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('bde:refresh'))
        return
      }

      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
      }
    },
    [setView, paletteOpen, shortcutsOpen, closePalette, togglePalette]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="app-shell elevation-0">
      <TitleBar
        sessionCount={runningCount}
        totalCost={totalCost}
        onConflictClick={() => setView('sprint')}
      />
      <div className="app-shell__body">
        <ActivityBar connectionStatus={status} />
        <div className="app-shell__content">
          <PanelRenderer node={root} />
        </div>
      </div>
      <StatusBar
        status={status}
        sessionCount={runningCount}
        model={DEFAULT_MODEL.modelId}
        onReconnect={() => connect()}
      />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <AnimatePresence>
        {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      </AnimatePresence>
      <ToastContainer />
    </div>
  )
}

export { App }
