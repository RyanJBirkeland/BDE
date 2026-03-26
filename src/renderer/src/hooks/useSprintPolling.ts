/**
 * useSprintPolling — manages adaptive sprint data polling.
 * Extracted from SprintCenter to reduce component complexity.
 */
import { useEffect } from 'react'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { useSprintTasks } from '../stores/sprintTasks'
import { POLL_SPRINT_INTERVAL, POLL_SPRINT_ACTIVE_MS } from '../lib/constants'
import { TASK_STATUS } from '../../../shared/constants'

export function useSprintPolling(): void {
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)

  // Adaptive sprint polling — consistency backstop
  const hasActiveTasks = tasks.some((t) => t.status === TASK_STATUS.ACTIVE)
  const sprintPollMs = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL

  useEffect(() => {
    loadData()
  }, [loadData])
  useVisibilityAwareInterval(loadData, sprintPollMs)

  // Instant refresh when an external process writes to bde.db
  useEffect(() => {
    return window.api.onExternalSprintChange(loadData)
  }, [loadData])
}
