import React from 'react'
import { X } from 'lucide-react'
import type { PanelTab } from '../../stores/panelLayout'

interface TearoffTabBarProps {
  tabs: PanelTab[]
  activeTab: number
  onSelectTab: (index: number) => void
  onCloseTab: (index: number) => void
}

export function TearoffTabBar({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab
}: TearoffTabBarProps): React.ReactElement {
  const showClose = tabs.length > 1

  return (
    <div className="tearoff-tab-bar" role="tablist">
      {tabs.map((tab, i) => (
        <div
          key={`${tab.viewKey}-${i}`}
          className={`tearoff-tab${i === activeTab ? ' tearoff-tab--active' : ''}`}
          role="tab"
          aria-selected={i === activeTab}
          tabIndex={i === activeTab ? 0 : -1}
          onClick={() => onSelectTab(i)}
        >
          <span>{tab.label}</span>
          {showClose && (
            <button
              className="tearoff-tab__close"
              aria-label={`Close ${tab.label}`}
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(i)
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
