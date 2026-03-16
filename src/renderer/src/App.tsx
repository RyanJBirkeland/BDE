import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGatewayStore } from './stores/gateway'
import { useUIStore, type View } from './stores/ui'
import { useSessionsStore } from './stores/sessions'
import { useCommandPaletteStore } from './stores/commandPalette'
import { calcCost, resolveModel } from './lib/cost'
import { ActivityBar } from './components/layout/ActivityBar'
import { TitleBar } from './components/layout/TitleBar'
import { StatusBar } from './components/layout/StatusBar'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/layout/ToastContainer'
import { Button } from './components/ui/Button'
import { Kbd } from './components/ui/Kbd'
import { useTaskNotifications } from './hooks/useTaskNotifications'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import SprintView from './views/SprintView'
import { SessionsView } from './views/SessionsView'
import MemoryView from './views/MemoryView'
import DiffView from './views/DiffView'
import CostView from './views/CostView'
import SettingsView from './views/SettingsView'
import { TerminalView } from './views/TerminalView'
import { VARIANTS, SPRINGS } from './lib/motion'

const VIEW_ORDER: View[] = [
  'sessions',
  'terminal',
  'sprint',
  'diff',
  'memory',
  'cost',
  'settings'
]

const VIEW_TITLES: Record<View, string> = {
  sessions: 'Sessions',
  terminal: 'Terminal',
  sprint: 'Planning',
  diff: 'Diff',
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

function ViewRouter({ activeView }: { activeView: View }): React.JSX.Element {
  const wrap = (name: string, el: React.JSX.Element): React.JSX.Element => (
    <div key={name} className="view-enter">
      <ErrorBoundary name={name}>{el}</ErrorBoundary>
    </div>
  )
  return (
    <>
      {/* Terminal and Sessions stay mounted so PTY sessions and chat state survive navigation */}
      <div className="view-enter" style={{ display: activeView === 'terminal' ? 'flex' : 'none' }}>
        <ErrorBoundary name="Terminal"><TerminalView /></ErrorBoundary>
      </div>
      <div className="view-enter" style={{ display: activeView === 'sessions' ? 'flex' : 'none' }}>
        <ErrorBoundary name="Sessions"><SessionsView /></ErrorBoundary>
      </div>
      {/* Other views mount on demand */}
      {activeView === 'sprint' && wrap('Sprint', <SprintView />)}
      {activeView === 'memory' && wrap('Memory', <MemoryView />)}
      {activeView === 'diff' && wrap('Diff', <DiffView />)}
      {activeView === 'cost' && wrap('Cost', <CostView />)}
      {activeView === 'settings' && wrap('Settings', <SettingsView />)}
      {!['terminal','sessions','sprint','memory','diff','cost','settings'].includes(activeView) && (
        <div className="view-router">
          <span className="view-router__placeholder">{String(activeView)} — coming soon</span>
        </div>
      )}
    </>
  )
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
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
        transition={SPRINGS.smooth}
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
  const runningCount = useSessionsStore((s) => s.runningCount)
  const sessions = useSessionsStore((s) => s.sessions)
  const totalCost = sessions.reduce((sum, s) => {
    const input = s.contextTokens ?? 0
    const output = Math.max(0, (s.totalTokens ?? 0) - (s.contextTokens ?? 0))
    return sum + calcCost(input, output, resolveModel(s.model))
  }, 0)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    connect()
  }, [connect])

  useTaskNotifications()

  useEffect(() => {
    const title = 'BDE \u2014 ' + VIEW_TITLES[activeView]
    document.title = title
    window.api.setTitle(title)
  }, [activeView])

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
      <TitleBar sessionCount={runningCount} totalCost={totalCost} />
      <div className="app-shell__body">
        <ActivityBar connectionStatus={status} />
        <div className="app-shell__content">
          <ViewRouter activeView={activeView} />
        </div>
      </div>
      <StatusBar
        status={status}
        sessionCount={runningCount}
        model="claude-sonnet-4-6"
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

export default App
