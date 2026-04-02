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

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number): void => {
    let nextIndex = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (index + 1) % tabs.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (index - 1 + tabs.length) % tabs.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = tabs.length - 1
    } else {
      return
    }
    onSelectTab(nextIndex)
    const tabList = e.currentTarget.parentElement
    const nextButton = tabList?.children[nextIndex] as HTMLElement | undefined
    nextButton?.focus()
  }

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
          onKeyDown={(e) => handleTabKeyDown(e, i)}
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
