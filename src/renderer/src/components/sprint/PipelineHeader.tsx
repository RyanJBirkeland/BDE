import { GitMerge, HeartPulse, LayoutGrid, List } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
||||||| 61d03689
import { GitMerge, HeartPulse } from 'lucide-react'
import { GitMerge, HeartPulse, Network } from 'lucide-react'
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
  onDagToggle: () => void
  dagOpen: boolean
}

export function PipelineHeader({
  stats,
  conflictingTasks,
  visibleStuckTasks,
  onFilterClick,
  onConflictClick,
  onHealthCheckClick,
  onDagToggle,
  dagOpen
}: PipelineHeaderProps): React.JSX.Element {
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const setPipelineDensity = useSprintUI((s) => s.setPipelineDensity)

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
      <button
        className="sprint-pipeline__density-toggle"
        onClick={() => setPipelineDensity(pipelineDensity === 'card' ? 'compact' : 'card')}
        title={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
        aria-label={pipelineDensity === 'card' ? 'Switch to compact view' : 'Switch to card view'}
      >
        {pipelineDensity === 'card' ? <List size={14} /> : <LayoutGrid size={14} />}
      </button>
||||||| 61d03689
      <button
        className={`sprint-pipeline__badge ${dagOpen ? 'sprint-pipeline__badge--active' : ''}`}
        onClick={onDagToggle}
        title="Toggle dependency graph"
        aria-label="Toggle dependency graph visualization"
      >
        <Network size={12} />
        <span>DAG</span>
      </button>
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
