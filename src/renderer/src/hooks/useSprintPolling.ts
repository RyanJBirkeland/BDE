/**
 * useSprintPolling — manages adaptive sprint data polling.
 * Extracted from SprintCenter to reduce component complexity.
 */
import { useEffect } from 'react'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { useSprintTasks } from '../stores/sprintTasks'
import { POLL_SPRINT_INTERVAL, POLL_SPRINT_ACTIVE_MS } from '../lib/constants'

export function useSprintPolling(): void {
  // Use derived activeTaskCount (O(1)) instead of .some() scan (O(n))
  const hasActiveTasks = useSprintTasks((s) => s.activeTaskCount > 0)
  const loadData = useSprintTasks((s) => s.loadData)

  // Adaptive sprint polling — consistency backstop
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
