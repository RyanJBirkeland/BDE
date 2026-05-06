import type { SprintTask } from '../../../../shared/types'
import { validateGitHubUrl } from '../../lib/utils'

export interface UpstreamOutcomesProps {
  upstreamTasks: SprintTask[]
  onNavigate: (taskId: string) => void
}

/**
 * Shows upstream dependency task outcomes — status, PR links, and notes.
 * Allows clicking to navigate to each dependency task for context.
 */
export function UpstreamOutcomes({
  upstreamTasks,
  onNavigate
}: UpstreamOutcomesProps): React.JSX.Element | null {
  if (upstreamTasks.length === 0) return null

  return (
    <div className="task-drawer__upstream">
      <div className="task-drawer__upstream-label">Upstream Outcomes</div>
      <div className="task-drawer__upstream-list">
        {upstreamTasks.map((dep) => (
          <button
            key={dep.id}
            className={`task-drawer__upstream-card task-drawer__upstream-card--${dep.status}`}
            onClick={() => onNavigate(dep.id)}
            type="button"
          >
            <div className="task-drawer__upstream-header">
              <span className="task-drawer__upstream-dot" />
              <span className="task-drawer__upstream-title">{dep.title}</span>
              <span className="task-drawer__upstream-status">{dep.status}</span>
            </div>

            {(() => {
              const safePrUrl = validateGitHubUrl(dep.pr_url)
              return safePrUrl ? (
                <a
                  href={safePrUrl}
                  className="task-drawer__upstream-pr"
                  onClick={(e) => e.stopPropagation()}
                  target="_blank"
                  rel="noreferrer"
                >
                  PR #{dep.pr_number} ({dep.pr_status ?? 'unknown'}) →
                </a>
              ) : null
            })()}

            {dep.notes && (
              <div className="task-drawer__upstream-notes">
                {dep.notes.length > 100 ? `${dep.notes.slice(0, 100)}...` : dep.notes}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
