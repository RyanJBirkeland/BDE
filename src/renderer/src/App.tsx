import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCommandPaletteStore } from './stores/commandPalette'
import { useSprintUI } from './stores/sprintUI'
import { CommandPalette } from './components/layout/CommandPalette'
import { QuickCreateBar } from './components/sprint/QuickCreateBar'
import { ToastContainer } from './components/layout/ToastContainer'
import { UnifiedHeader } from './components/layout/UnifiedHeader'
import { Sidebar } from './components/layout/Sidebar'
import { Onboarding } from './components/Onboarding'
import './App.css'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { Button } from './components/ui/Button'
import { Kbd } from './components/ui/Kbd'
import { useGitHubErrorListener } from './hooks/useGitHubErrorListener'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useOnboardingCheck } from './hooks/useOnboardingCheck'
import { useAppInitialization } from './hooks/useAppInitialization'
import { PanelRenderer } from './components/panels/PanelRenderer'
import { useCrossWindowDrop } from './hooks/useCrossWindowDrop'
import { CrossWindowDropOverlay } from './components/panels/CrossWindowDropOverlay'
import { usePanelLayoutStore } from './stores/panelLayout'
import type { View } from './stores/panelLayout'
import { TearoffShell } from './components/layout/TearoffShell'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from './lib/motion'
import { DEFAULT_MODEL } from '../../shared/models'
import { VIEW_LABELS } from './lib/view-registry'
import { PollingProvider } from './components/PollingProvider'
import { SHORTCUT_CATEGORIES } from './lib/shortcuts-data'
import { FeatureGuideModal } from './components/help/FeatureGuideModal'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { FloatingAgentButton } from './components/floating-agent/FloatingAgentButton'

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

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const root = usePanelLayoutStore((s) => s.root)

  const paletteOpen = useCommandPaletteStore((s) => s.isOpen)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const quickCreateOpen = useSprintUI((s) => s.quickCreateOpen)
  const setQuickCreateOpen = useSprintUI((s) => s.setQuickCreateOpen)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [featureGuideOpen, setFeatureGuideOpen] = useState(false)

  const showOnboarding = useOnboardingCheck()
  useAppInitialization()
  useAppShortcuts({ paletteOpen, shortcutsOpen, setShortcutsOpen })

  useGitHubErrorListener()
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
    window.api.window.setTitle(title)
  }, [activeView])

  useEffect(() => {
    const handler = (): void => {
      setFeatureGuideOpen(true)
    }
    window.addEventListener('bde:open-feature-guide', handler)
    return () => window.removeEventListener('bde:open-feature-guide', handler)
  }, [])

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
          window.location.reload()
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
          <Sidebar model={DEFAULT_MODEL.modelId} />
          <main id="main-content" className="app-shell__content" aria-label="Main content">
            <PanelRenderer node={root} />
          </main>
        </div>
        <QuickCreateBar
          open={quickCreateOpen}
          onClose={() => setQuickCreateOpen(false)}
          defaultRepo=""
        />
        <CommandPalette open={paletteOpen} onClose={closePalette} />
        <AnimatePresence>
          {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
        </AnimatePresence>
        <FeatureGuideModal open={featureGuideOpen} onClose={() => setFeatureGuideOpen(false)} />
        <ToastContainer />
        <FloatingAgentButton />
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
    return (
      <ErrorBoundary name="AppRoot">
        <TearoffShell view={_tearoffView} windowId={_tearoffWindowId} />
      </ErrorBoundary>
    )
  }
  return (
    <ErrorBoundary name="AppRoot">
      <App />
    </ErrorBoundary>
  )
}

export { App, AppRoot }
