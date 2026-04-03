import { GitMerge, HeartPulse } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'

interface StatBadge {
  label: string
  count: number
  filter: 'in-progress' | 'todo' | 'blocked' | 'awaiting-review' | 'failed' | 'done'
}

interface PipelineHeaderProps {
  stats: StatBadge[]
  conflictingTasks: SprintTask[]
  visibleStuckTasks: SprintTask[]
  onFilterClick: (filter: StatBadge['filter']) => void
  onConflictClick: () => void
  onHealthCheckClick: () => void
}

export function PipelineHeader({
  stats,
  conflictingTasks,
  visibleStuckTasks,
  onFilterClick,
  onConflictClick,
  onHealthCheckClick
}: PipelineHeaderProps): React.JSX.Element {
  return (
    <header className="sprint-pipeline__header">
      <h1 className="sprint-pipeline__title">Task Pipeline</h1>
      <div className="sprint-pipeline__stats">
        {stats.map((stat) => (
          <span
            key={stat.label}
            className={`sprint-pipeline__stat sprint-pipeline__stat--${stat.label} sprint-pipeline__stat--clickable`}
            onClick={() => onFilterClick(stat.filter)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onFilterClick(stat.filter)
            }}
          >
            <b className="sprint-pipeline__stat-count">{stat.count}</b> {stat.label}
          </span>
        ))}
      </div>
      {conflictingTasks.length > 0 && (
        <button
          className="sprint-pipeline__badge sprint-pipeline__badge--danger"
          onClick={onConflictClick}
          title={`${conflictingTasks.length} PR conflict${conflictingTasks.length > 1 ? 's' : ''}`}
          aria-label={`${conflictingTasks.length} merge conflict${conflictingTasks.length > 1 ? 's' : ''}`}
        >
          <GitMerge size={12} />
          <span>{conflictingTasks.length}</span>
        </button>
      )}
      {visibleStuckTasks.length > 0 && (
        <button
          className="sprint-pipeline__badge sprint-pipeline__badge--warning"
          onClick={onHealthCheckClick}
          title={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
          aria-label={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
        >
          <HeartPulse size={12} />
          <span>{visibleStuckTasks.length}</span>
        </button>
      )}
    </header>
  )
}
