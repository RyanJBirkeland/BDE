import './SidebarV2.css'
import React from 'react'
import {
  LayoutDashboard,
  GitBranch,
  Users,
  GitPullRequest,
  Code2,
  GitCommitHorizontal,
  Settings,
  ListTodo,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { usePanelLayoutStore, type View } from '../../stores/panelLayout'
import { VIEW_REGISTRY } from '../../lib/view-registry'
import {
  useSprintTasks,
  selectReviewTaskCount,
  selectFailedTaskCount,
  type SprintTasksState
} from '../../stores/sprintTasks'
import type { SprintTask } from '../../../../shared/types'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useGitTreeStore } from '../../stores/gitTree'
import { LiveAgentRow } from './LiveAgentRow'

interface SidebarV2Props {
  model?: string | undefined
}

interface NavItem {
  view: View
  icon: React.ReactNode
}

const selectActiveTasks = (s: SprintTasksState): SprintTask[] =>
  s.tasks.filter((t) => t.status === 'active')

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard',   icon: <LayoutDashboard    size={16} strokeWidth={1.5} /> },
  { view: 'sprint',      icon: <ListTodo           size={16} strokeWidth={1.5} /> },
  { view: 'planner',     icon: <GitBranch          size={16} strokeWidth={1.5} /> },
  { view: 'agents',      icon: <Users              size={16} strokeWidth={1.5} /> },
  { view: 'code-review', icon: <GitPullRequest     size={16} strokeWidth={1.5} /> },
  { view: 'ide',         icon: <Code2              size={16} strokeWidth={1.5} /> },
  { view: 'git',         icon: <GitCommitHorizontal size={16} strokeWidth={1.5} /> },
  { view: 'settings',    icon: <Settings           size={16} strokeWidth={1.5} /> },
]

export function SidebarV2({ model }: SidebarV2Props): React.JSX.Element {
  const activeView = usePanelLayoutStore((s) => s.activeView)
  const setView = usePanelLayoutStore((s) => s.setView)
  const branch = useGitTreeStore((s) => s.branch)

  const reviewCount = useSprintTasks(selectReviewTaskCount)
  const failedCount = useSprintTasks(selectFailedTaskCount)
  const activeTasks = useSprintTasks(useShallow(selectActiveTasks))

  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)

  const handleNavClick = (view: View): void => setView(view)

  const handleAgentClick = (taskId: string): void => {
    setView('sprint')
    setSelectedTaskId(taskId)
  }

  return (
    <aside className="sidebar-v2">
      {/* Workspace header */}
      <div className="sidebar-v2__workspace">
        <span className="fleet-eyebrow">Workspace</span>
        {branch && <span className="sidebar-v2__branch">{branch}</span>}
      </div>

      {/* Nav */}
      <nav className="sidebar-v2__nav">
        {NAV_ITEMS.map(({ view, icon }) => {
          const label = VIEW_REGISTRY[view].label
          const isActive = activeView === view
          const badge =
            view === 'code-review' ? reviewCount
            : view === 'sprint' ? failedCount
            : undefined
          const badgeVariant =
            view === 'code-review' ? 'review'
            : view === 'sprint' ? 'failed'
            : undefined
          const showPulse = view === 'agents' && activeTasks.length > 0

          return (
            <button
              key={view}
              className={`sidebar-v2__nav-row${isActive ? ' sidebar-v2__nav-row--active' : ''}`}
              onClick={() => handleNavClick(view)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`sidebar-nav-${view}`}
            >
              <span className="sidebar-v2__nav-icon">{icon}</span>
              <span className="sidebar-v2__nav-label">{label}</span>
              {showPulse && <span className="fleet-pulse" style={{ width: 6, height: 6 }} />}
              {!showPulse && badge != null && badge > 0 && (
                <span className={`sidebar-v2__badge${badgeVariant ? ` sidebar-v2__badge--${badgeVariant}` : ''}`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-v2__spacer" />

      {/* Live agents */}
      {activeTasks.length > 0 && (
        <>
          <div className="sidebar-v2__live-header">
            <span className="fleet-eyebrow">Live</span>
            <span className="sidebar-v2__live-count">{activeTasks.length}</span>
          </div>
          <div className="sidebar-v2__live-agents">
            {activeTasks.slice(0, 3).map((task) => (
              <LiveAgentRow
                key={task.id}
                title={task.title}
                onClick={() => handleAgentClick(task.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="sidebar-v2__footer">
        {model && <span className="sidebar-v2__footer-model">{model}</span>}
        <span className="sidebar-v2__footer-version">v2</span>
      </div>
    </aside>
  )
}
