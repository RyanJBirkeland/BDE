import React, { Suspense, useState, useCallback, useRef } from 'react'
import { PanelLeafNode, View, DropZone, usePanelLayoutStore } from '../../stores/panelLayout'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { tokens } from '../../design-system/tokens'
import { PanelDropOverlay } from './PanelDropOverlay'
import { AgentsView } from '../../views/AgentsView'

// ---------------------------------------------------------------------------
// Lazy-loaded views
// ---------------------------------------------------------------------------

const DashboardView = React.lazy(() => import('../../views/DashboardView'))
const IDEView = React.lazy(() => import('../../views/IDEView'))
const SprintView = React.lazy(() => import('../../views/SprintView'))
const MemoryView = React.lazy(() => import('../../views/MemoryView'))
const CostView = React.lazy(() => import('../../views/CostView'))
const SettingsView = React.lazy(() => import('../../views/SettingsView'))
const PRStationView = React.lazy(() => import('../../views/PRStationView'))
const TaskWorkbenchView = React.lazy(() => import('../../views/TaskWorkbenchView'))
const GitTreeView = React.lazy(() => import('../../views/GitTreeView'))

// ---------------------------------------------------------------------------
// Lazy view preloading map — trigger on hover in ActivityBar
// ---------------------------------------------------------------------------

export const VIEW_LOADERS: Partial<Record<View, () => Promise<unknown>>> = {
  dashboard: () => import('../../views/DashboardView'),
  sprint: () => import('../../views/SprintView'),
  memory: () => import('../../views/MemoryView'),
  cost: () => import('../../views/CostView'),
  settings: () => import('../../views/SettingsView'),
  'pr-station': () => import('../../views/PRStationView'),
  'task-workbench': () => import('../../views/TaskWorkbenchView'),
  git: () => import('../../views/GitTreeView'),
  ide: () => import('../../views/IDEView')
}

// ---------------------------------------------------------------------------
// View registry
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
    case 'memory':
      return <MemoryView />
    case 'cost':
      return <CostView />
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
// ViewSkeleton — pulsing loading fallback
// ---------------------------------------------------------------------------

function ViewSkeleton(): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%'
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: tokens.radius.full,
          background: tokens.color.surfaceHigh,
          animation: 'bde-pulse 1.2s ease-in-out infinite'
        }}
      />
      <style>{`
        @keyframes bde-pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PanelLeaf
// ---------------------------------------------------------------------------

interface PanelLeafProps {
  node: PanelLeafNode
}

interface DragPayload {
  viewKey: string
  sourcePanelId?: string
  sourceTabIndex?: number
}

export function PanelLeaf({ node }: PanelLeafProps): React.ReactElement {
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const focusPanel = usePanelLayoutStore((s) => s.focusPanel)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const isFocused = focusedPanelId === node.panelId

  function handlePanelClick(): void {
    focusPanel(node.panelId)
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.types.includes('application/bde-panel')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    const container = containerRef.current
    if (container && !container.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = useCallback((panelId: string, zone: DropZone, data: DragPayload): void => {
    if (data.sourcePanelId !== undefined && data.sourceTabIndex !== undefined) {
      usePanelLayoutStore.getState().moveTab(data.sourcePanelId, data.sourceTabIndex, panelId, zone)
    } else if (data.viewKey) {
      if (zone === 'center') {
        usePanelLayoutStore.getState().addTab(panelId, data.viewKey as View)
      } else {
        const dir: 'horizontal' | 'vertical' =
          zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
        usePanelLayoutStore.getState().splitPanel(panelId, dir, data.viewKey as View)
      }
    }
    setIsDragOver(false)
  }, [])

  return (
    <div
      ref={containerRef}
      onClick={handlePanelClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        background: tokens.color.surface,
        outline: isFocused ? `1px solid ${tokens.color.accent}` : '1px solid transparent',
        overflow: 'hidden',
        boxSizing: 'border-box',
        position: 'relative'
      }}
    >
      {isFocused ? null : (
        <div className="panel-label-slim" onClick={() => focusPanel(node.panelId)}>
          {node.tabs[node.activeTab]?.label ?? 'Untitled'}
        </div>
      )}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {node.tabs.map((tab, index) => {
          const isActive = index === node.activeTab
          return (
            <div
              key={`${tab.viewKey}-${index}`}
              role="tabpanel"
              aria-labelledby={`panel-tab-${tab.viewKey}-${node.panelId}`}
              style={{
                position: 'absolute',
                inset: 0,
                display: isActive ? 'flex' : 'none',
                flexDirection: 'column'
              }}
            >
              <ErrorBoundary name={tab.label}>
                <Suspense fallback={<ViewSkeleton />}>{resolveView(tab.viewKey)}</Suspense>
              </ErrorBoundary>
            </div>
          )
        })}
      </div>
      {isDragOver && <PanelDropOverlay panelId={node.panelId} onDrop={handleDrop} />}
    </div>
  )
}

export default PanelLeaf
