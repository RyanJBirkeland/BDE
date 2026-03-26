import { X } from 'lucide-react'
import { useIDEStore } from '../../stores/ide'

export interface EditorTabBarProps {
  onCloseTab?: (tabId: string, isDirty: boolean) => void
}

export function EditorTabBar({ onCloseTab }: EditorTabBarProps): React.JSX.Element {
  const openTabs = useIDEStore((s) => s.openTabs)
  const activeTabId = useIDEStore((s) => s.activeTabId)
  const setActiveTab = useIDEStore((s) => s.setActiveTab)
  const closeTab = useIDEStore((s) => s.closeTab)

  function handleClose(e: React.MouseEvent, tabId: string, isDirty: boolean): void {
    e.stopPropagation()
    if (onCloseTab) onCloseTab(tabId, isDirty)
    else closeTab(tabId)
  }

  function handleMiddleClick(e: React.MouseEvent, tabId: string, isDirty: boolean): void {
    if (e.button === 1) {
      e.preventDefault()
      if (onCloseTab) onCloseTab(tabId, isDirty)
      else closeTab(tabId)
    }
  }

  return (
    <div className="ide-editor-tab-bar" role="tablist" aria-label="Editor tabs">
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`ide-editor-tab${isActive ? ' ide-editor-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id, tab.isDirty)}
            title={tab.filePath}
          >
            <span className="ide-editor-tab__name">{tab.displayName}</span>
            {tab.isDirty && (
              <span className="ide-editor-tab__dirty" aria-label="unsaved changes">
                &#x25cf;
              </span>
            )}
            <button
              className="ide-editor-tab__close"
              onClick={(e) => handleClose(e, tab.id, tab.isDirty)}
              aria-label={`Close ${tab.displayName}`}
              tabIndex={-1}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
