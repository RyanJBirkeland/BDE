import { ChevronRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../../stores/ide'

export function EditorBreadcrumb(): React.JSX.Element | null {
  const { activeTabId, openTabs, rootPath } = useIDEStore(
    useShallow((s) => ({
      activeTabId: s.activeTabId,
      openTabs: s.openTabs,
      rootPath: s.rootPath
    }))
  )

  const activeTab = openTabs.find((t) => t.id === activeTabId)
  if (!activeTab || !rootPath) return null

  // Build path relative to root
  const relativePath = activeTab.filePath.startsWith(rootPath)
    ? activeTab.filePath.slice(rootPath.length).replace(/^\//, '')
    : activeTab.filePath

  const segments = relativePath.split('/')
  if (segments.length === 0) return null

  return (
    <nav className="editor-breadcrumb" aria-label="File path">
      {segments.map((segment, i) => (
        <span key={i} className="editor-breadcrumb__item">
          {i > 0 && <ChevronRight size={12} className="editor-breadcrumb__sep" />}
          <span
            className={
              i === segments.length - 1
                ? 'editor-breadcrumb__segment editor-breadcrumb__segment--active'
                : 'editor-breadcrumb__segment'
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </nav>
  )
}
