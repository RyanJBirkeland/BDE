import { StatCounter } from '../neon'
import { StatusFilter } from '../../stores/sprintUI'
import {
  Activity,
  GitPullRequest,
  CheckCircle,
  Zap,
  AlertTriangle,
  XCircle,
  Eye,
  Plus
} from 'lucide-react'

interface StatusCountersProps {
  stats: {
    active: number
    queued: number
    blocked: number
    failed: number
    review: number
    done: number
  }
  awaitingReviewCount: number
  onFilterClick: (filter: StatusFilter) => void
  onNewTaskClick: () => void
}

/** Left column of status counter cards with navigation. */
export function StatusCounters({
  stats,
  awaitingReviewCount,
  onFilterClick,
  onNewTaskClick
}: StatusCountersProps): React.JSX.Element {
  return (
    <div className="dashboard-col" role="region" aria-label="Task statistics">
      <StatCounter
        label="Active"
        value={stats.active}
        accent="cyan"
        suffix="live"
        icon={<Zap size={10} />}
        onClick={() => onFilterClick('in-progress')}
      />
      <StatCounter
        label="Queued"
        value={stats.queued}
        accent="orange"
        icon={<Activity size={10} />}
        onClick={() => onFilterClick('todo')}
      />
      <StatCounter
        label="Blocked"
        value={stats.blocked}
        accent="red"
        icon={<AlertTriangle size={10} />}
        onClick={() => onFilterClick('blocked')}
      />
      <StatCounter
        label="Failed"
        value={stats.failed}
        accent="red"
        icon={<XCircle size={10} />}
        onClick={() => onFilterClick('failed')}
      />
      <StatCounter
        label="Review"
        value={stats.review}
        accent="blue"
        icon={<Eye size={10} />}
        onClick={() => onFilterClick('awaiting-review')}
      />
      <StatCounter
        label="PRs"
        value={awaitingReviewCount}
        accent="blue"
        icon={<GitPullRequest size={10} />}
        onClick={() => onFilterClick('awaiting-review')}
      />
      <StatCounter
        label="Done"
        value={stats.done}
        accent="cyan"
        icon={<CheckCircle size={10} />}
        onClick={() => onFilterClick('done')}
      />
      <button className="dashboard-new-task-btn" onClick={onNewTaskClick}>
        <Plus size={12} /> New Task
      </button>
    </div>
  )
}
