import { useCallback, useEffect, useMemo } from 'react'
import { useHealthCheckStore } from '../stores/healthCheck'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { POLL_HEALTH_CHECK_MS } from '../lib/constants'
import type { SprintTask } from '../../../shared/types'

/**
 * useHealthCheck — detects stuck active tasks and surfaces them for the UI.
 * Polls on a visibility-aware interval and allows per-task dismissal.
 */
export function useHealthCheck(tasks: SprintTask[]) {
  const setStuckTasks = useHealthCheckStore((s) => s.setStuckTasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch {
      /* silent */
    }
  }, [setStuckTasks])

  useEffect(() => {
    runHealthCheck()
  }, [runHealthCheck])
  useVisibilityAwareInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.includes(t.id) && !dismissedIds.includes(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  return { visibleStuckTasks, dismissTask }
}
