import { useCallback, useEffect, useState } from 'react'
import { useGatewayStore } from './stores/gateway'
import { useUIStore, type View } from './stores/ui'
import { useSessionsStore } from './stores/sessions'
import { ActivityBar } from './components/layout/ActivityBar'
import { TitleBar } from './components/layout/TitleBar'
import { StatusBar } from './components/layout/StatusBar'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/layout/ToastContainer'
import SprintView from './views/SprintView'
import { SessionsView } from './views/SessionsView'
import MemoryView from './views/MemoryView'
import DiffView from './views/DiffView'
import CostView from './views/CostView'

const VIEW_ORDER: View[] = ['sessions', 'sprint', 'diff', 'memory', 'cost', 'settings']

const VIEW_TITLES: Record<View, string> = {
  sessions: 'Sessions',
  sprint: 'Sprint / PRs',
  diff: 'Diff',
  memory: 'Memory',
  cost: 'Cost',
  settings: 'Settings'
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '⌘1–6', description: 'Switch views' },
  { keys: '⌘K', description: 'Command palette' },
  { keys: '⌘R', description: 'Refresh current view' },
  { keys: '?', description: 'Show shortcuts' }
]

function ViewRouter({ activeView }: { activeView: View }): React.JSX.Element {
  if (activeView === 'sessions') return <SessionsView />
  if (activeView === 'sprint') return <SprintView />
  if (activeView === 'memory') return <MemoryView />
  if (activeView === 'diff') return <DiffView />
  if (activeView === 'cost') return <CostView />
  return (
    <div className="view-router">
      <span className="view-router__placeholder">
        {activeView.charAt(0).toUpperCase() + activeView.slice(1)} — coming soon
      </span>
    </div>
  )
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-overlay__panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="shortcuts-overlay__title">Keyboard Shortcuts</h2>
        <div className="shortcuts-overlay__list">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="shortcuts-overlay__row">
              <kbd className="shortcuts-overlay__kbd">{s.keys}</kbd>
              <span>{s.description}</span>
            </div>
          ))}
        </div>
        <button className="shortcuts-overlay__close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const connect = useGatewayStore((s) => s.connect)
  const activeView = useUIStore((s) => s.activeView)
  const setView = useUIStore((s) => s.setView)
  const runningCount = useSessionsStore((s) => s.runningCount)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    const title = `BDE — ${VIEW_TITLES[activeView]}`
    document.title = title
    window.api.setTitle(title)
  }, [activeView])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return
      }

      if (e.metaKey && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        setView(VIEW_ORDER[Number(e.key) - 1])
        return
      }

      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
        return
      }

      if (e.metaKey && e.key === 'r') {
        e.preventDefault()
        // Refresh placeholder — will be wired to real data later
        return
      }

      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
      }
    },
    [setView]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="app-shell">
      <TitleBar sessionCount={runningCount} totalCost={0} />

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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      <ToastContainer />
    </div>
  )
}

export default App
