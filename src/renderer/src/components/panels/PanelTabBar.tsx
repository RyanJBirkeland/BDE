import React from 'react'
import { X } from 'lucide-react'
import { PanelLeafNode, usePanelLayoutStore } from '../../stores/panelLayout'
import { tokens } from '../../design-system/tokens'

// ---------------------------------------------------------------------------
// PanelTabBar — tab strip with drag source capability
// ---------------------------------------------------------------------------

interface PanelTabBarProps {
  node: PanelLeafNode
}

export function PanelTabBar({ node }: PanelTabBarProps): React.ReactElement {
  const setActiveTab = usePanelLayoutStore((s) => s.setActiveTab)
  const closeTab = usePanelLayoutStore((s) => s.closeTab)
  const focusPanel = usePanelLayoutStore((s) => s.focusPanel)
  const root = usePanelLayoutStore((s) => s.root)

  // Hide close button when this is the only panel with a single tab (nothing to close into)
  const isOnlyPanel = root.type === 'leaf' && node.tabs.length === 1

  function handleTabClick(index: number): void {
    focusPanel(node.panelId)
    setActiveTab(node.panelId, index)
  }

  function handleTabClose(index: number, e: React.MouseEvent): void {
    e.stopPropagation()
    closeTab(node.panelId, index)
  }

  function handleDragStart(
    index: number,
    e: React.DragEvent<HTMLDivElement>,
  ): void {
    const tab = node.tabs[index]
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(
      'application/bde-panel',
      JSON.stringify({
        viewKey: tab.viewKey,
        sourcePanelId: node.panelId,
        sourceTabIndex: index,
      }),
    )
    e.dataTransfer.setData('text/plain', tab.label)
  }

  return (
    <div
      role="tablist"
      aria-label="Panel tabs"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '28px',
        background: tokens.color.surface,
        borderBottom: `1px solid ${tokens.color.border}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {node.tabs.map((tab, index) => {
        const isActive = index === node.activeTab
        return (
          <div
            key={`${tab.viewKey}-${index}`}
            role="tab"
            aria-selected={isActive}
            id={`panel-tab-${tab.viewKey}-${node.panelId}`}
            title={tab.label}
            draggable={true}
            onDragStart={(e) => handleDragStart(index, e)}
            onClick={() => handleTabClick(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              padding: `0 ${tokens.space[2]}`,
              height: '100%',
              cursor: 'pointer',
              background: isActive ? tokens.color.surfaceHigh : 'transparent',
              color: isActive ? tokens.color.text : tokens.color.textMuted,
              fontSize: tokens.size.sm,
              fontFamily: tokens.font.ui,
              borderRight: `1px solid ${tokens.color.border}`,
              userSelect: 'none',
              whiteSpace: 'nowrap',
              transition: `color ${tokens.transition.fast}`,
            }}
          >
            <span>{tab.label}</span>
            {!isOnlyPanel && (
              <button
                onClick={(e) => handleTabClose(index, e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  padding: '0',
                  cursor: 'pointer',
                  color: 'inherit',
                  opacity: 0.6,
                  lineHeight: 1,
                }}
                aria-label={`Close ${tab.label}`}
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default PanelTabBar
