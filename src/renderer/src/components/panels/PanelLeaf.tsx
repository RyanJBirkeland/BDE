import React, { Suspense, useState, useCallback, useRef } from 'react'
import { PanelLeafNode, View, DropZone, usePanelLayoutStore } from '../../stores/panelLayout'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { PanelDropOverlay } from './PanelDropOverlay'
import { resolveView } from '../../lib/view-resolver'
import './PanelLeaf.css'

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
  sourcePanelId?: string | undefined
  sourceTabIndex?: number | undefined
}

export function PanelLeaf({ node }: PanelLeafProps): React.ReactElement {
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const focusPanel = usePanelLayoutStore((s) => s.focusPanel)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const isFocused = focusedPanelId === node.panelId
  const showDirtyIndicator = false

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
        <button type="button" className="panel-label-slim" onClick={() => focusPanel(node.panelId)}>
          {node.tabs[node.activeTab]?.label ?? 'Untitled'}
          {showDirtyIndicator && <span className="panel-label-dirty-dot"> •</span>}
        </button>
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
