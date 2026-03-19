import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
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
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { SessionsView } from './views/SessionsView'   // always-mounted
import { TerminalView } from './views/TerminalView'    // always-mounted

const SprintView = lazy(() => import('./views/SprintView'))
const MemoryView = lazy(() => import('./views/MemoryView'))
const DiffView = lazy(() => import('./views/DiffView'))
const CostView = lazy(() => import('./views/CostView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const PRStationView = lazy(() => import('./views/PRStationView'))
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from './lib/motion'

const VIEW_ORDER: View[] = [
  'sessions',
  'terminal',
  'sprint',
  'diff',
  'pr-station',
  'memory',
  'cost',
  'settings'
]

const VIEW_TITLES: Record<View, string> = {
  sessions: 'Sessions',
  terminal: 'Terminal',
  sprint: 'Planning',
  diff: 'Diff',
  'pr-station': 'PR Station',
  memory: 'Memory',
  cost: 'Cost',
  settings: 'Settings'
}

const SHORTCUTS_LEFT: { keys: string; description: string }[] = [
  { keys: '\u23181\u20138', description: 'Switch views' },
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

function ViewSkeleton(): React.JSX.Element {
  return (
    <div className="view-enter" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <div className="animate-pulse" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bde-surface-2)' }} />
    </div>
  )
}

function ViewRouter({ activeView }: { activeView: View }): React.JSX.Element {
  const reduced = useReducedMotion()

  const onDemandView = (() => {
    switch (activeView) {
      case 'sprint': return <ErrorBoundary name="Sprint"><SprintView /></ErrorBoundary>
      case 'pr-station': return <ErrorBoundary name="PR Station"><PRStationView /></ErrorBoundary>
      case 'memory': return <ErrorBoundary name="Memory"><MemoryView /></ErrorBoundary>
      case 'diff': return <ErrorBoundary name="Diff"><DiffView /></ErrorBoundary>
      case 'cost': return <ErrorBoundary name="Cost"><CostView /></ErrorBoundary>
      case 'settings': return <ErrorBoundary name="Settings"><SettingsView /></ErrorBoundary>
      default: return null
    }
  })()

  return (
    <>
      {/* Terminal and Sessions stay mounted so PTY sessions and chat state survive navigation */}
      <div className="view-enter" style={{ display: activeView === 'terminal' ? 'flex' : 'none' }}>
        <ErrorBoundary name="Terminal"><TerminalView /></ErrorBoundary>
      </div>
      <div className="view-enter" style={{ display: activeView === 'sessions' ? 'flex' : 'none' }}>
        <ErrorBoundary name="Sessions"><SessionsView /></ErrorBoundary>
      </div>
      {/* On-demand views animate in/out */}
      <AnimatePresence mode="popLayout">
        {onDemandView && (
          <motion.div
            key={activeView}
            className="view-enter"
            variants={VARIANTS.fadeIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.gentle}
          >
            <Suspense fallback={<ViewSkeleton />}>
              {onDemandView}
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      {!['terminal','sessions','sprint','pr-station','memory','diff','cost','settings'].includes(activeView) && (
        <div className="view-router">
          <span className="view-router__placeholder">{String(activeView)} — coming soon</span>
        </div>
      )}
    </>
  )
}

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
  const runningCount = useSessionsStore((s) => s.runningCount)
  const totalCost = useCostDataStore((s) => s.totalCost)
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

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
      if (view === 'sessions') {
        setView('sessions')
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

      if (e.metaKey && e.key >= '1' && e.key <= '8') {
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
      <TitleBar
        sessionCount={runningCount}
        totalCost={totalCost}
        onConflictClick={() => setView('sprint')}
      />
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
