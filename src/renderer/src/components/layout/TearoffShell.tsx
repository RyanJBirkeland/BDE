import React, { Suspense, useState, useEffect } from 'react'
import { Undo2 } from 'lucide-react'
import { View } from '../../stores/panelLayout'
import { VIEW_LABELS } from '../../lib/view-registry'
import '../../assets/tearoff-shell.css'

// ---------------------------------------------------------------------------
// Lazy-loaded views (same pattern as PanelLeaf)
// ---------------------------------------------------------------------------

const DashboardView = React.lazy(() => import('../../views/DashboardView'))
const AgentsView = React.lazy(() =>
  import('../../views/AgentsView').then((m) => ({ default: m.AgentsView }))
)
const IDEView = React.lazy(() => import('../../views/IDEView'))
const SprintView = React.lazy(() => import('../../views/SprintView'))
const SettingsView = React.lazy(() => import('../../views/SettingsView'))
const PRStationView = React.lazy(() => import('../../views/PRStationView'))
const TaskWorkbenchView = React.lazy(() => import('../../views/TaskWorkbenchView'))
const GitTreeView = React.lazy(() => import('../../views/GitTreeView'))

// ---------------------------------------------------------------------------
// View resolver
// ---------------------------------------------------------------------------

function resolveView(viewKey: View): React.ReactNode {
  switch (viewKey) {
    case 'dashboard':
      return <DashboardView />
    case 'agents':
      return <AgentsView />
    case 'ide':
      return <IDEView />
    case 'sprint':
      return <SprintView />
    case 'settings':
      return <SettingsView />
    case 'pr-station':
      return <PRStationView />
    case 'task-workbench':
      return <TaskWorkbenchView />
    case 'git':
      return <GitTreeView />
  }
}

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

  const label = VIEW_LABELS[view] ?? view

  useEffect(() => {
    const unsub = window.api.tearoff.onConfirmClose(() => {
      setShowDialog(true)
    })
    return unsub
  }, [])

  function handleReturn(): void {
    window.api.tearoff.returnToMain(windowId)
  }

  function handleDialogClose(action: 'return' | 'close', remember: boolean): void {
    setShowDialog(false)
    void window.api.tearoff.closeConfirmed({ action, remember })
  }

  return (
    <div className="tearoff-shell">
      <header className="tearoff-shell__header">
        <span className="tearoff-shell__title">{label}</span>
        <div className="tearoff-shell__actions">
          <button
            className="tearoff-shell__btn"
            aria-label="Return to main window"
            onClick={handleReturn}
          >
            <Undo2 size={14} />
          </button>
        </div>
      </header>
      <main className="tearoff-shell__content">
        <Suspense fallback={null}>{resolveView(view)}</Suspense>
      </main>
      {showDialog && <CloseDialog onClose={handleDialogClose} />}
    </div>
  )
}

export default TearoffShell
