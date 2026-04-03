import React, { Suspense, useState, useCallback, useRef } from 'react'
import { PanelLeafNode, View, DropZone, usePanelLayoutStore } from '../../stores/panelLayout'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { PanelDropOverlay } from './PanelDropOverlay'
import { resolveView } from '../../lib/view-resolver'

// ---------------------------------------------------------------------------
// Lazy view preloading map — trigger on hover in ActivityBar
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components
export const VIEW_LOADERS: Partial<Record<View, () => Promise<unknown>>> = {
  dashboard: () => import('../../views/DashboardView'),
  sprint: () => import('../../views/SprintView'),
  settings: () => import('../../views/SettingsView'),
  'code-review': () => import('../../views/CodeReviewView'),
  'task-workbench': () => import('../../views/TaskWorkbenchView'),
  git: () => import('../../views/GitTreeView'),
  ide: () => import('../../views/IDEView')
}

// ---------------------------------------------------------------------------
// ViewSkeleton — pulsing loading fallback
// ---------------------------------------------------------------------------

function ViewSkeleton(): React.ReactElement {
  return (
    <div className="view-skeleton">
      <div className="view-skeleton__pulse" />
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
      data-panel-id={node.panelId}
      className={`panel-leaf ${isFocused ? 'panel-leaf--focused' : ''}`}
      onClick={handlePanelClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isFocused ? null : (
        <div className="panel-label-slim" onClick={() => focusPanel(node.panelId)}>
          {node.tabs[node.activeTab]?.label ?? 'Untitled'}
        </div>
      )}
      <div className="panel-leaf__content">
        {node.tabs.map((tab, index) => {
          const isActive = index === node.activeTab
          return (
            <div
              key={`${tab.viewKey}-${index}`}
              role="tabpanel"
              aria-labelledby={`panel-tab-${tab.viewKey}-${node.panelId}`}
              className={`panel-leaf__tabpanel ${isActive ? 'panel-leaf__tabpanel--active' : ''}`}
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
