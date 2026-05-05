import type { ActivityMode } from './ActivityRail'
import { FilesPanel } from './panels/FilesPanel'
import { SearchPanel } from './panels/SearchPanel'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IDESidebarProps {
  activity: ActivityMode
  activeFilePath: string | null
  onOpenFile: (path: string) => void
  open: boolean
}

// ---------------------------------------------------------------------------
// Stub panels — implemented in Task 4
// ---------------------------------------------------------------------------

function ComingSoonPlaceholder(): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-3)',
        fontSize: 'var(--t-sm)'
      }}
    >
      Coming in Task 4
    </div>
  )
}

// ---------------------------------------------------------------------------
// IDESidebar
// ---------------------------------------------------------------------------

export function IDESidebar({
  activity,
  activeFilePath,
  onOpenFile,
  open
}: IDESidebarProps): React.JSX.Element | null {
  if (!open) return null

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        background: 'var(--surf-1)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      {activity === 'files' && (
        <FilesPanel activeFilePath={activeFilePath} onOpenFile={onOpenFile} />
      )}
      {activity === 'search' && <SearchPanel />}
      {activity === 'scm' && <ComingSoonPlaceholder />}
      {activity === 'outline' && <ComingSoonPlaceholder />}
      {activity === 'agents' && <ComingSoonPlaceholder />}
    </div>
  )
}
