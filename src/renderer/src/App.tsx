import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCommandPaletteStore } from './stores/commandPalette'
import { useCostDataStore } from './stores/costData'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/layout/ToastContainer'
import { UnifiedHeader } from './components/layout/UnifiedHeader'
import { NeonSidebar } from './components/layout/NeonSidebar'
import { Onboarding } from './components/Onboarding'
import { Button } from './components/ui/Button'
import { Kbd } from './components/ui/Kbd'
import { useAgentHistoryStore } from './stores/agentHistory'
import { usePendingReviewStore } from './stores/pendingReview'
import { useGitHubRateLimitWarning } from './hooks/useGitHubRateLimitWarning'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { PanelRenderer } from './components/panels/PanelRenderer'
import { useCrossWindowDrop } from './hooks/useCrossWindowDrop'
import { CrossWindowDropOverlay } from './components/panels/CrossWindowDropOverlay'
import { usePanelLayoutStore, findLeaf } from './stores/panelLayout'
import type { View } from './stores/panelLayout'
import { TearoffShell } from './components/layout/TearoffShell'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from './lib/motion'
import { DEFAULT_MODEL } from '../../shared/models'
import { VIEW_SHORTCUT_MAP, VIEW_LABELS } from './lib/view-registry'
import './assets/neon.css'
import './assets/neon-shell.css'
import './assets/agents-neon.css'

// Query params are read once at module load time — outside any component to avoid
// violating Rules of Hooks if we need to conditionally skip the full App render.
const _params = new URLSearchParams(window.location.search)
const _tearoffView = _params.get('view') as View | null
const _tearoffWindowId = _params.get('windowId')

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
    <div
      className="shortcuts-overlay elevation-3-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
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
  const [ready, setReady] = useState(false)

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const setView = usePanelLayoutStore((s) => s.setView)
  const root = usePanelLayoutStore((s) => s.root)
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const loadLayout = usePanelLayoutStore((s) => s.loadSavedLayout)
  const restorePendingReview = usePendingReviewStore((s) => s.restoreFromStorage)

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useEffect(() => {
    loadLayout()
  }, [loadLayout])

  useEffect(() => {
    restorePendingReview()
  }, [restorePendingReview])

  useGitHubRateLimitWarning()
  useDesktopNotifications()
  const crossDrop = useCrossWindowDrop()
  // Listen for tab removal from tear-off
  useEffect(() => {
    if (!window.api?.tearoff) return
    return window.api.tearoff.onTabRemoved((payload) => {
      usePanelLayoutStore.getState().closeTab(payload.sourcePanelId, payload.sourceTabIndex)
    })
  }, [])

  // Listen for tab return from tear-off
  useEffect(() => {
    if (!window.api?.tearoff) return
    return window.api.tearoff.onTabReturned((payload) => {
      const store = usePanelLayoutStore.getState()
      const targetId = store.focusedPanelId ?? ''
      if (targetId) {
        store.addTab(targetId, payload.view as View)
      }
    })
  }, [])

  // Execute tab add/split when cross-window drop completes
  useEffect(() => {
    if (!window.api?.tearoff?.onCrossWindowDrop) return
    return window.api.tearoff.onCrossWindowDrop((payload) => {
      const store = usePanelLayoutStore.getState()
      if (payload.zone === 'center') {
        store.addTab(payload.targetPanelId, payload.view as View)
      } else {
        const direction = (payload.zone === 'left' || payload.zone === 'right') ? 'horizontal' : 'vertical'
        store.splitPanel(payload.targetPanelId, direction, payload.view as View)
      }
    })
  }, [])

  // Escape key cancels cross-window drag when overlay is active
  useEffect(() => {
    if (!crossDrop.active) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.api?.tearoff?.sendDragCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [crossDrop.active])

  useEffect(() => {
    const title = 'BDE \u2014 ' + VIEW_LABELS[activeView]
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
      const target = e.target as HTMLElement
      const tag = target.tagName
      const inInput =
        target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        e.preventDefault()
        if (paletteOpen) {
          closePalette()
          return
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false)
          return
        }
        if (inInput) {
          ;(document.activeElement as HTMLElement)?.blur()
          return
        }
        window.dispatchEvent(new CustomEvent('bde:escape'))
        return
      }

      if (inInput && !e.metaKey) return

      if (e.metaKey && e.key >= '0' && e.key <= '9') {
        const target = VIEW_SHORTCUT_MAP[e.key]
        if (target) {
          e.preventDefault()
          setView(target)
        }
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

  if (!ready) {
    return <Onboarding onReady={() => setReady(true)} />
  }

  return (
    <div className="app-shell elevation-0">
      <a
        href="#main-content"
        className="sr-only"
        style={{
          position: 'absolute',
          top: '-40px',
          left: 0,
          background: 'var(--bde-text)',
          color: 'var(--bde-bg)',
          padding: '8px 16px',
          zIndex: 9999,
          transition: 'top 0.2s'
        }}
        onFocus={(e) => {
          e.currentTarget.style.top = '0'
        }}
        onBlur={(e) => {
          e.currentTarget.style.top = '-40px'
        }}
      >
        Skip to main content
      </a>
      <UnifiedHeader />
      <div className="app-shell__body">
        <NeonSidebar model={DEFAULT_MODEL.modelId} />
        <main id="main-content" className="app-shell__content" aria-label="Main content">
          <PanelRenderer node={root} />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <AnimatePresence>
        {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      </AnimatePresence>
      <ToastContainer />
      <CrossWindowDropOverlay
        active={crossDrop.active}
        localX={crossDrop.localX}
        localY={crossDrop.localY}
        viewKey={crossDrop.viewKey ?? ''}
        onDrop={crossDrop.handleDrop}
      />
    </div>
  )
}

/**
 * AppRoot — thin wrapper that checks query params before rendering the full App.
 * Tear-off windows load the same HTML entry point but with ?view=<view>&windowId=<id>,
 * which causes TearoffShell to render instead of the full panel system.
 *
 * Query params are read at module load (outside any component) so that no hooks
 * are called conditionally — Rules of Hooks is satisfied because App's hooks only
 * run when AppRoot decides to render <App />.
 */
function AppRoot(): React.JSX.Element {
  if (_tearoffView && _tearoffWindowId) {
    return <TearoffShell view={_tearoffView} windowId={_tearoffWindowId} />
  }
  return <App />
}

export { App, AppRoot }
