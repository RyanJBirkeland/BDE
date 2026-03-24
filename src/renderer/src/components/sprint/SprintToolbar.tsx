/**
 * SprintToolbar — header bar for Sprint Center.
 * Contains repo filter chips, alert badges, shortcut hints, new-ticket button, and refresh.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useUIStore } from '../../stores/ui'
import { REPO_OPTIONS } from '../../lib/constants'
import type { SprintTask } from '../../../../shared/types'

interface SprintToolbarProps {
  visibleStuckTasks: SprintTask[]
  conflictingTasks: SprintTask[]
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
  onOpenConflictDrawer: () => void
  onOpenHealthDrawer: () => void
}

export function SprintToolbar({
  visibleStuckTasks,
  conflictingTasks,
  setConflictDrawerOpen,
  onOpenConflictDrawer,
  onOpenHealthDrawer,
}: SprintToolbarProps) {
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const loading = useSprintTasks((s) => s.loading)
  const loadData = useSprintTasks((s) => s.loadData)

  const setView = useUIStore((s) => s.setView)
  const openWorkbench = useCallback(() => setView('task-workbench'), [setView])

  // Keyboard shortcuts: N -> open task workbench, Esc -> close drawers
  useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })

  return (
    <>
      <div className="sprint-center__header">
        <div className="sprint-center__title-row">
          <span className="sprint-center__title text-gradient-aurora">SPRINT CENTER</span>
          <div className="sprint-board__repo-switcher">
            {REPO_OPTIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRepoFilter(repoFilter === r.label ? null : r.label)}
                className={`sprint-board__repo-chip ${repoFilter === r.label ? 'sprint-board__repo-chip--active' : ''}`}
                style={
                  repoFilter === r.label ? { borderColor: r.color, color: r.color } : undefined
                }
              >
                <span className="sprint-board__repo-dot" style={{ background: r.color }} />
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setRepoFilter(null)}
              className={`sprint-board__repo-chip ${repoFilter === null ? 'sprint-board__repo-chip--active' : ''}`}
            >
              All
            </button>
          </div>
        </div>
        <div className="sprint-center__actions">
          {visibleStuckTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={onOpenHealthDrawer}
              title="Stuck tasks detected"
            >
              <Badge variant="warning" size="sm">
                {visibleStuckTasks.length} stuck
              </Badge>
            </button>
          )}
          {conflictingTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={onOpenConflictDrawer}
              title="View merge conflicts"
            >
              <Badge variant="danger" size="sm">
                {conflictingTasks.length} conflict{conflictingTasks.length > 1 ? 's' : ''}
              </Badge>
            </button>
          )}
          <kbd className="sprint-center__shortcut-hint" title="Keyboard shortcuts">
            N — New ticket &nbsp; Esc — Close
          </kbd>
          <Button variant="primary" size="sm" onClick={openWorkbench}>
            + New Ticket
          </Button>
          <Button variant="icon" size="sm" onClick={loadData} disabled={loading} title="Refresh">
            &#x21bb;
          </Button>
        </div>
      </div>

    </>
  )
}
