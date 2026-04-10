import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCommandPaletteStore } from './stores/commandPalette'
import { useCostDataStore } from './stores/costData'
import { useSprintUI } from './stores/sprintUI'
import { useKeybindingsStore } from './stores/keybindings'
import { CommandPalette } from './components/layout/CommandPalette'
import { QuickCreateBar } from './components/ui/QuickCreateBar'
import { ToastContainer } from './components/layout/ToastContainer'
import { UnifiedHeader } from './components/layout/UnifiedHeader'
import { NeonSidebar } from './components/layout/NeonSidebar'
import { Onboarding } from './components/Onboarding'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { Button } from './components/ui/Button'
import { Kbd } from './components/ui/Kbd'
import { useAgentHistoryStore } from './stores/agentHistory'
import { usePendingReviewStore } from './stores/pendingReview'
import { useFilterPresets } from './stores/filterPresets'
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
import { VIEW_LABELS } from './lib/view-registry'
import { PollingProvider } from './components/PollingProvider'
import { openSettings } from './lib/settings-nav'
import { SHORTCUT_CATEGORIES } from './lib/shortcuts-data'
import { FeatureGuideModal } from './components/help/FeatureGuideModal'
import './assets/shell.css'

// Query params are read once at module load time — outside any component to avoid
// violating Rules of Hooks if we need to conditionally skip the full App render.
const _params = new URLSearchParams(window.location.search)
const _tearoffView = _params.get('view') as View | null
const _tearoffWindowId = _params.get('windowId')

function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  const reduced = useReducedMotion()
  const [activeTab, setActiveTab] = useState(0)

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

  const currentCategory = SHORTCUT_CATEGORIES[activeTab]

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
        <div className="shortcuts-overlay__tabs" role="tablist">
          {SHORTCUT_CATEGORIES.map((category, index) => (
            <button
              key={category.name}
              role="tab"
              aria-selected={activeTab === index}
              aria-controls={`shortcuts-panel-${index}`}
              className={`shortcuts-overlay__tab${activeTab === index ? ' shortcuts-overlay__tab--active' : ''}`}
              onClick={() => setActiveTab(index)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <div
          id={`shortcuts-panel-${activeTab}`}
          role="tabpanel"
          className="shortcuts-overlay__content"
        >
          {currentCategory.shortcuts.map((shortcut) => (
            <div key={shortcut.keys} className="shortcuts-overlay__row">
              <Kbd>{shortcut.keys}</Kbd>
              <span>{shortcut.description}</span>
            </div>
          ))}
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
  const [showOnboarding, setShowOnboarding] = useState(false)

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const setView = usePanelLayoutStore((s) => s.setView)
  const root = usePanelLayoutStore((s) => s.root)
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const quickCreateOpen = useSprintUI((s) => s.quickCreateOpen)
  const setQuickCreateOpen = useSprintUI((s) => s.setQuickCreateOpen)
  const toggleQuickCreate = useSprintUI((s) => s.toggleQuickCreate)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [featureGuideOpen, setFeatureGuideOpen] = useState(false)

  const loadLayout = usePanelLayoutStore((s) => s.loadSavedLayout)
  const restorePendingReview = usePendingReviewStore((s) => s.restoreFromStorage)
  const restoreFilterPresets = useFilterPresets((s) => s.restoreFromStorage)
  const initKeybindings = useKeybindingsStore((s) => s.init)

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useEffect(() => {
    initKeybindings()
  }, [initKeybindings])

  useEffect(() => {
    window.api.settings.get('onboarding.completed').then((val) => {
      if (!val) {
        setShowOnboarding(true)
      }
    })
  }, [])

  useEffect(() => {
    loadLayout()
  }, [loadLayout])

  useEffect(() => {
    restorePendingReview()
  }, [restorePendingReview])

  useEffect(() => {
    restoreFilterPresets()
  }, [restoreFilterPresets])

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
        const direction =
          payload.zone === 'left' || payload.zone === 'right' ? 'horizontal' : 'vertical'
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

  useEffect(() => {
    const handler = (): void => {
      setShortcutsOpen(true)
    }
    window.addEventListener('bde:show-shortcuts', handler)
    return () => window.removeEventListener('bde:show-shortcuts', handler)
  }, [])

  useEffect(() => {
    const handler = (): void => {
      setFeatureGuideOpen(true)
    }
    window.addEventListener('bde:open-feature-guide', handler)
    return () => window.removeEventListener('bde:open-feature-guide', handler)
  }, [])

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

      // Build current key combo for matching against keybindings
      const parts: string[] = []
      if (e.metaKey) parts.push('⌘')
      if (e.ctrlKey && !e.metaKey) parts.push('Ctrl')
      if (e.altKey) parts.push('⌥')
      if (e.shiftKey) parts.push('⇧')
      parts.push(e.key.toUpperCase())
      const combo = parts.join('')

      const bindings = useKeybindingsStore.getState().bindings

      // View navigation shortcuts
      if (combo === bindings['view.dashboard']) {
        e.preventDefault()
        setView('dashboard')
        return
      }
      if (combo === bindings['view.agents']) {
        e.preventDefault()
        setView('agents')
        return
      }
      if (combo === bindings['view.ide']) {
        e.preventDefault()
        setView('ide')
        return
      }
      if (combo === bindings['view.sprint']) {
        e.preventDefault()
        setView('sprint')
        return
      }
      if (combo === bindings['view.codeReview']) {
        e.preventDefault()
        setView('code-review')
        return
      }
      if (combo === bindings['view.git']) {
        e.preventDefault()
        setView('git')
        return
      }
      if (combo === bindings['view.settings']) {
        e.preventDefault()
        setView('settings')
        return
      }
      if (combo === bindings['view.taskWorkbench']) {
        e.preventDefault()
        setView('task-workbench')
        return
      }
      if (combo === bindings['view.planner']) {
        e.preventDefault()
        setView('planner')
        return
      }

      // Settings shortcut with deep linking
      if (combo === bindings['settings.open']) {
        e.preventDefault()
        openSettings()
        return
      }

      // Panel shortcuts
      if (combo === bindings['panel.splitRight']) {
        e.preventDefault()
        const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
        if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal', 'agents')
        return
      }

      if (combo === bindings['panel.closeTab']) {
        e.preventDefault()
        const { focusedPanelId, root } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf) usePanelLayoutStore.getState().closeTab(focusedPanelId, leaf.activeTab)
        }
        return
      }

      if (combo === bindings['panel.nextTab'] || combo === bindings['panel.prevTab']) {
        e.preventDefault()
        const { focusedPanelId, root, setActiveTab } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf && leaf.tabs.length > 1) {
            const delta = combo === bindings['panel.nextTab'] ? 1 : -1
            const next = (leaf.activeTab + delta + leaf.tabs.length) % leaf.tabs.length
            setActiveTab(focusedPanelId, next)
          }
        }
        return
      }

      // Command palette
      if (combo === bindings['palette.toggle']) {
        e.preventDefault()
        togglePalette()
        return
      }

      // Refresh
      if (combo === bindings['refresh']) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('bde:refresh'))
        return
      }

      // Quick create
      if (combo === bindings['quickCreate.toggle']) {
        e.preventDefault()
        toggleQuickCreate()
        return
      }

      // Shortcuts overlay (special case - no modifiers)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
      }
    },
    [setView, paletteOpen, shortcutsOpen, closePalette, togglePalette, toggleQuickCreate]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Save timestamp on window close for morning briefing detection
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      localStorage.setItem('bde:last-window-close', Date.now().toString())
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => {
          window.api.settings.set('onboarding.completed', 'true')
          setShowOnboarding(false)
        }}
      />
    )
  }

  if (!ready) {
    return <Onboarding onReady={() => setReady(true)} />
  }

  return (
    <PollingProvider>
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
        <QuickCreateBar
          open={quickCreateOpen}
          onClose={() => setQuickCreateOpen(false)}
          defaultRepo="bde"
        />
        <CommandPalette open={paletteOpen} onClose={closePalette} />
        <AnimatePresence>
          {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
        </AnimatePresence>
        <FeatureGuideModal open={featureGuideOpen} onClose={() => setFeatureGuideOpen(false)} />
        <ToastContainer />
        <CrossWindowDropOverlay
          active={crossDrop.active}
          localX={crossDrop.localX}
          localY={crossDrop.localY}
          onDrop={crossDrop.handleDrop}
        />
      </div>
    </PollingProvider>
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
