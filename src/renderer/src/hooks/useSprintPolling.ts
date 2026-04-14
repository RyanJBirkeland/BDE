/**
 * useSprintPolling — manages adaptive sprint data polling.
 * Extracted from SprintCenter to reduce component complexity.
 */
import { useEffect } from 'react'
import { useBackoffInterval } from './useBackoffInterval'
import { useSprintTasks, selectActiveTaskCount } from '../stores/sprintTasks'
import { POLL_SPRINT_INTERVAL, POLL_SPRINT_ACTIVE_MS } from '../lib/constants'

export function useSprintPolling(): void {
  const hasActiveTasks = useSprintTasks((s) => selectActiveTaskCount(s) > 0)
  const loadData = useSprintTasks((s) => s.loadData)

  // Adaptive sprint polling — consistency backstop
  const sprintPollMs = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL

  useEffect(() => {
    loadData()
  }, [loadData])
  useBackoffInterval(loadData, sprintPollMs)

  // Instant refresh when an external process writes to bde.db
  useEffect(() => {
    return window.api.sprint.onExternalChange(loadData)
  }, [loadData])
}
