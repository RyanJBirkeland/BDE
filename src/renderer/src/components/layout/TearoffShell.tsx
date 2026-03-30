import React, { Suspense, useState, useEffect } from 'react'
import { Undo2 } from 'lucide-react'
import {
  usePanelLayoutStore,
  createLeaf,
  findLeaf,
  getOpenViews,
  addTab,
  type PanelNode,
  type View
} from '../../stores/panelLayout'
import { VIEW_LABELS } from '../../lib/view-registry'
import { resolveView } from '../../lib/view-resolver'
import { PanelRenderer } from '../panels/PanelRenderer'
import { TearoffTabBar } from './TearoffTabBar'
import { useCrossWindowDrop } from '../../hooks/useCrossWindowDrop'
import { CrossWindowDropOverlay } from '../panels/CrossWindowDropOverlay'
import '../../assets/tearoff-shell.css'

// ---------------------------------------------------------------------------
// Close dialog
// ---------------------------------------------------------------------------

interface CloseDialogProps {
  onClose: (action: 'return' | 'close', remember: boolean) => void
}

function CloseDialog({ onClose }: CloseDialogProps): React.ReactElement {
  const [remember, setRemember] = useState(false)

  return (
    <div className="tearoff-shell__dialog-overlay" role="dialog" aria-modal aria-label="Close window">
      <div className="tearoff-shell__dialog">
        <p>Return this tab to the main window?</p>
        <label className="tearoff-shell__dialog-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember my choice
        </label>
        <div className="tearoff-shell__dialog-actions">
          <button className="bde-btn bde-btn--ghost" onClick={() => onClose('close', remember)}>
            Close
          </button>
          <button className="bde-btn bde-btn--primary" onClick={() => onClose('return', remember)}>
            Return
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TearoffShell
// ---------------------------------------------------------------------------

interface TearoffShellProps {
  view: View
  windowId: string
}

export function TearoffShell({ view, windowId }: TearoffShellProps): React.ReactElement {
  const [showDialog, setShowDialog] = useState(false)
  const crossDrop = useCrossWindowDrop()

  const restoreParam = new URLSearchParams(window.location.search).get('restore')
  const initialViews: View[] = restoreParam
    ? (JSON.parse(decodeURIComponent(restoreParam)) as View[])
    : [view]

  const label = VIEW_LABELS[view] ?? view

  // Initialize panel store for this tear-off window
  useEffect(() => {
    usePanelLayoutStore.getState().setPersistable(false)
    if (initialViews.length <= 1) {
      const leaf = createLeaf(initialViews[0] || view)
      usePanelLayoutStore.setState({ root: leaf, focusedPanelId: leaf.panelId, activeView: initialViews[0] || view })
    } else {
      // Restore multiple views as tabs in a single leaf
      const leaf = createLeaf(initialViews[0])
      let current: PanelNode = leaf
      for (let i = 1; i < initialViews.length; i++) {
        const updated = addTab(current, leaf.panelId, initialViews[i])
        if (updated) current = updated
      }
      usePanelLayoutStore.setState({ root: current, focusedPanelId: leaf.panelId, activeView: initialViews[0] })
    }
  }, []) // only on mount — view is static from query params

  // Subscribe to store changes and notify main of open views (debounced)
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null
    const unsub = usePanelLayoutStore.subscribe((state) => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        const views = getOpenViews(state.root) as string[]
        window.api?.tearoff?.viewsChanged({ windowId, views })
      }, 500)
    })
    return () => {
      unsub()
      if (debounce) clearTimeout(debounce)
    }
  }, [windowId])

  // Derive mode from store
  const root = usePanelLayoutStore((s) => s.root)
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const isMultiTab = root.type === 'split' || (root.type === 'leaf' && root.tabs.length > 1)
  const focusedLeaf = focusedPanelId ? findLeaf(root, focusedPanelId) : null

  useEffect(() => {
    const unsub = window.api.tearoff.onConfirmClose(() => {
      setShowDialog(true)
    })
    return unsub
  }, [])

  // Close this tear-off window when drag completes to another window
  useEffect(() => {
    if (!window.api?.tearoff?.onDragDone) return
    return window.api.tearoff.onDragDone(() => {
      window.close()
    })
  }, [])

  // Handle cross-window tab drops — add tab or split panel
  useEffect(() => {
    if (!window.api?.tearoff?.onCrossWindowDrop) return
    return window.api.tearoff.onCrossWindowDrop((payload) => {
      const store = usePanelLayoutStore.getState()
      const targetId = payload.targetPanelId || store.focusedPanelId || ''
      if (payload.zone === 'center') {
        store.addTab(targetId, payload.view as View)
      } else {
        const direction =
          payload.zone === 'left' || payload.zone === 'right' ? 'horizontal' : 'vertical'
        store.splitPanel(targetId, direction, payload.view as View)
      }
    })
  }, [])

  // Escape key cancels cross-window drag when overlay is active
  useEffect(() => {
    if (!crossDrop.active) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api?.tearoff?.sendDragCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [crossDrop.active])

  // Cmd+W closes the active tab in panel mode
  useEffect(() => {
    if (!isMultiTab) return
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault()
        if (focusedLeaf && focusedLeaf.tabs.length > 0) {
          usePanelLayoutStore.getState().closeTab(focusedLeaf.panelId, focusedLeaf.activeTab)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMultiTab, focusedLeaf])

  function handleReturn(): void {
    window.api.tearoff.returnToMain(windowId)
  }

  function handleReturnAll(): void {
    const views = getOpenViews(usePanelLayoutStore.getState().root)
    window.api?.tearoff?.returnAll({ windowId, views: views as string[] })
  }

  function handleDialogClose(action: 'return' | 'close', remember: boolean): void {
    setShowDialog(false)
    void window.api.tearoff.closeConfirmed({ action, remember })
  }

  return (
    <div className="tearoff-shell">
      <header className="tearoff-shell__header">
        <span className="tearoff-shell__title">{isMultiTab ? '' : label}</span>
        <div className="tearoff-shell__actions">
          {isMultiTab ? (
            <button
              className="tearoff-shell__btn"
              onClick={handleReturnAll}
              aria-label="Return all tabs to main window"
              title="Return all"
            >
              <Undo2 size={14} />
            </button>
          ) : (
            <button
              className="tearoff-shell__btn"
              onClick={handleReturn}
              aria-label="Return to main window"
              title="Return to main window"
            >
              <Undo2 size={14} />
            </button>
          )}
        </div>
      </header>

      {isMultiTab && focusedLeaf && (
        <TearoffTabBar
          tabs={focusedLeaf.tabs}
          activeTab={focusedLeaf.activeTab}
          onSelectTab={(i) => usePanelLayoutStore.getState().setActiveTab(focusedLeaf.panelId, i)}
          onCloseTab={(i) => usePanelLayoutStore.getState().closeTab(focusedLeaf.panelId, i)}
        />
      )}

      <main className="tearoff-shell__content">
        {isMultiTab ? (
          <PanelRenderer node={root} />
        ) : (
          <Suspense fallback={null}>{resolveView(view)}</Suspense>
        )}
      </main>

      <CrossWindowDropOverlay
        active={crossDrop.active}
        localX={crossDrop.localX}
        localY={crossDrop.localY}
        viewKey={crossDrop.viewKey ?? ''}
        onDrop={crossDrop.handleDrop}
      />
      {showDialog && <CloseDialog onClose={handleDialogClose} />}
    </div>
  )
}

export default TearoffShell
