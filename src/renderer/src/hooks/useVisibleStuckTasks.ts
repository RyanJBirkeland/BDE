import { useMemo } from 'react'
import { useHealthCheckStore } from '../stores/healthCheck'
import { useSprintTasks } from '../stores/sprintTasks'
import type { SprintTask } from '../../../shared/types'

export function useVisibleStuckTasks(): {
  visibleStuckTasks: SprintTask[]
  dismissTask: (id: string) => void
} {
  const tasks = useSprintTasks((s) => s.tasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.includes(t.id) && !dismissedIds.includes(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  return { visibleStuckTasks, dismissTask }
}
