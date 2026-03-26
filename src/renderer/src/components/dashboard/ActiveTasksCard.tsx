import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { DashboardCard } from './DashboardCard'
import { useSprintTasks } from '../../stores/sprintTasks'
import { TASK_STATUS } from '../../../../shared/constants'
import { tokens } from '../../design-system/tokens'

const STATUS_COLORS: Record<string, string> = {
  [TASK_STATUS.ACTIVE]: tokens.color.accent,
  [TASK_STATUS.QUEUED]: tokens.color.info,
  [TASK_STATUS.BLOCKED]: tokens.color.warning
}

const STATUS_LABELS: Record<string, string> = {
  [TASK_STATUS.ACTIVE]: 'Active',
  [TASK_STATUS.QUEUED]: 'Queued',
  [TASK_STATUS.BLOCKED]: 'Blocked'
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const color = STATUS_COLORS[status] ?? tokens.color.textMuted
  return (
    <span
      style={{
        fontSize: tokens.size.xs,
        color,
        background: `${color}22`,
        borderRadius: tokens.radius.full,
        padding: `2px ${tokens.space[2]}`,
        fontWeight: 600,
        textTransform: 'capitalize',
        flexShrink: 0
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function ActiveTasksCard(): React.JSX.Element {
  const tasks = useSprintTasks((s) => s.tasks)

  const activeTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === TASK_STATUS.ACTIVE ||
          t.status === TASK_STATUS.QUEUED ||
          t.status === TASK_STATUS.BLOCKED
      ),
    [tasks]
  )

  return (
    <DashboardCard title="Active Tasks" icon={<Activity size={14} aria-hidden="true" />}>
      {activeTasks.length === 0 ? (
        <p
          style={{
            padding: `${tokens.space[4]} ${tokens.space[4]}`,
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm,
            margin: 0
          }}
        >
          No active tasks
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0
          }}
        >
          {activeTasks.map((task) => (
            <li
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[2],
                padding: `${tokens.space[2]} ${tokens.space[4]}`,
                borderBottom: `1px solid ${tokens.color.border}`,
                fontSize: tokens.size.sm
              }}
            >
              <span
                style={{
                  flex: 1,
                  color: tokens.color.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={task.title}
              >
                {task.title}
              </span>
              <span
                style={{
                  fontSize: tokens.size.xs,
                  color: tokens.color.textMuted,
                  flexShrink: 0
                }}
              >
                {task.repo}
              </span>
              <StatusBadge status={task.status} />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
