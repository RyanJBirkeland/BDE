import { useMemo } from 'react'
import { CheckCircle } from 'lucide-react'
import { DashboardCard } from './DashboardCard'
import { useSprintTasks } from '../../stores/sprintTasks'
import { TASK_STATUS } from '../../../../shared/constants'
import { tokens } from '../../design-system/tokens'

const MAX_COMPLETIONS = 5

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function RecentCompletionsCard(): React.JSX.Element {
  const tasks = useSprintTasks((s) => s.tasks)

  const recentDone = useMemo(() => {
    return tasks
      .filter((t) => t.status === TASK_STATUS.DONE)
      .sort((a, b) => {
        const aTime = a.completed_at ?? a.updated_at
        const bTime = b.completed_at ?? b.updated_at
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })
      .slice(0, MAX_COMPLETIONS)
  }, [tasks])

  return (
    <DashboardCard title="Recent Completions" icon={<CheckCircle size={14} aria-hidden="true" />}>
      {recentDone.length === 0 ? (
        <p
          style={{
            padding: `${tokens.space[4]} ${tokens.space[4]}`,
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm,
            margin: 0
          }}
        >
          No completed tasks yet
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {recentDone.map((task) => (
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
              <CheckCircle
                size={12}
                color={tokens.color.success}
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              />
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
                style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted, flexShrink: 0 }}
              >
                {formatRelative(task.completed_at ?? task.updated_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
