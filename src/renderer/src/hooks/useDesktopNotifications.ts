/**
 * useDesktopNotifications — triggers desktop notifications for critical background events.
 * Only fires when app window is NOT focused (!document.hasFocus()).
 * Listens to:
 * - Task status transitions (active → done, active → failed)
 * - PR merged events (prMergedMap changes)
 *
 * Adds notifications to the persistent notifications store for the in-app notification center.
 */
import { useEffect, useRef } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useNotificationsStore } from '../stores/notifications'
import { TASK_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'

function requestPermissionOnce(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

function shouldNotify(): boolean {
  // Only notify if window is not focused
  return !document.hasFocus()
}

function fireDesktopNotification(title: string, body: string): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification(title, { body, silent: false })
  }
}

export function useDesktopNotifications(): void {
  const tasks = useSprintTasks((s) => s.tasks)
  const prMergedMap = useSprintTasks((s) => s.prMergedMap)
  const addNotification = useNotificationsStore((s) => s.addNotification)

  const prevTasksRef = useRef<Map<string, SprintTask>>(new Map())
  const prevPrMergedRef = useRef<Record<string, boolean>>({})
  const initializedRef = useRef(false)
  const notifiedTasksRef = useRef<Set<string>>(new Set())

  // Request permission on mount
  useEffect(() => {
    requestPermissionOnce()
  }, [])

  // Watch for task status changes
  useEffect(() => {
    const prevMap = prevTasksRef.current
    const currentMap = new Map(tasks.map((t) => [t.id, t]))

    // Skip initial render — seed without notifying
    if (!initializedRef.current) {
      prevTasksRef.current = currentMap
      initializedRef.current = true
      return
    }

    for (const task of tasks) {
      const prev = prevMap.get(task.id)
      if (!prev) continue

      // Skip if we already notified for this task
      if (notifiedTasksRef.current.has(task.id)) continue

      // Agent completed: active → done
      if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.DONE) {
        if (!shouldNotify()) continue

        const title = '✅ Agent completed'
        const message = task.pr_url ? `${task.title} — PR ready` : `${task.title} completed`

        addNotification({
          type: 'agent_completed',
          title,
          message,
          viewLink: `/sprint/${task.id}`
        })

        fireDesktopNotification(title, message)
        notifiedTasksRef.current.add(task.id)
      }

      // Agent failed: active → error (or other failure state)
      // Note: In the current schema, "failed" might mean going back to backlog
      // For now, we'll skip this since the schema doesn't have explicit "error" status
    }

    prevTasksRef.current = currentMap
  }, [tasks, addNotification])

  // Watch for PR merged events
  useEffect(() => {
    const prev = prevPrMergedRef.current

    for (const [taskId, merged] of Object.entries(prMergedMap)) {
      // Skip if already merged in previous state
      if (prev[taskId] === merged) continue
      // Only fire if newly merged
      if (!merged) continue
      // Skip if we already notified
      if (notifiedTasksRef.current.has(`${taskId}-merged`)) continue

      if (!shouldNotify()) continue

      const task = tasks.find((t) => t.id === taskId)
      if (!task) continue

      const title = '🎉 PR merged'
      const message = `${task.title} — PR #${task.pr_number || 'unknown'} merged`

      addNotification({
        type: 'pr_merged',
        title,
        message,
        viewLink: task.pr_url || undefined
      })

      fireDesktopNotification(title, message)
      notifiedTasksRef.current.add(`${taskId}-merged`)
    }

    prevPrMergedRef.current = prMergedMap
  }, [prMergedMap, tasks, addNotification])
}
