/**
 * useSprintPolling — manages adaptive sprint data polling and SSE real-time updates.
 * Extracted from SprintCenter to reduce component complexity.
 */
import { useEffect, useRef, useMemo } from 'react'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { useSprintTasks } from '../stores/sprintTasks'
import { useSprintEvents } from '../stores/sprintEvents'
import { subscribeSSE } from '../lib/taskRunnerSSE'
import {
  POLL_SPRINT_INTERVAL,
  POLL_SPRINT_ACTIVE_MS,
  SSE_DEBOUNCE_MS,
} from '../lib/constants'
import { TASK_STATUS } from '../../../shared/constants'

export function useSprintPolling(): void {
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const mergeSseUpdate = useSprintTasks((s) => s.mergeSseUpdate)
  const fetchQueueHealth = useSprintEvents((s) => s.fetchQueueHealth)

  // Adaptive sprint polling — consistency backstop (SSE handles real-time)
  const hasActiveTasks = tasks.some((t) => t.status === TASK_STATUS.ACTIVE)
  const sprintPollMs = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL

  useEffect(() => { loadData(); fetchQueueHealth() }, [loadData, fetchQueueHealth])
  useVisibilityAwareInterval(loadData, sprintPollMs)
  useVisibilityAwareInterval(fetchQueueHealth, sprintPollMs)

  // Instant refresh when an external process writes to bde.db
  useEffect(() => {
    return window.api.onExternalSprintChange(loadData)
  }, [loadData])

  // Real-time task updates via SSE singleton — surgical merge + debounced backstop
  const debouncedLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedLoadData = useMemo(
    () => () => {
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
      debouncedLoadRef.current = setTimeout(loadData, SSE_DEBOUNCE_MS)
    },
    [loadData]
  )

  useEffect(() => {
    const unsub = subscribeSSE('task:updated', (data: unknown) => {
      const raw = data as Record<string, unknown>
      mergeSseUpdate({ ...raw, taskId: (raw.taskId ?? raw.id) as string })
      debouncedLoadData()
    })
    return () => {
      unsub()
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
    }
  }, [mergeSseUpdate, debouncedLoadData])
}
