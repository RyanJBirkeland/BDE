/**
 * useDesktopNotifications — triggers desktop notifications for critical background events.
 * Only fires when app window is NOT focused (!document.hasFocus()).
 * Listens to:
 * - Task status transitions (active → done, active → review, active → failed/error)
 * - PR merged events (prMergedMap changes)
 *
 * Adds notifications to the persistent notifications store for the in-app notification center.
 * Respects per-event-type preferences (desktop / in-app / off).
 */
import { useEffect, useRef, useState } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useNotificationsStore, type NotificationType } from '../stores/notifications'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { TASK_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'

type DeliveryMode = 'desktop' | 'in-app' | 'off'

interface NotificationPreferences {
  master: boolean
  agent_completed: DeliveryMode
  agent_failed: DeliveryMode
  pr_merged: DeliveryMode
  pr_closed: DeliveryMode
  merge_conflict: DeliveryMode
}

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

function fireDesktopNotification(
  title: string,
  body: string,
  onClick?: () => void
): Notification | null {
  if (!('Notification' in window)) return null
  if (Notification.permission !== 'granted') return null

  const notification = new Notification(title, { body, silent: false })
  if (onClick) {
    notification.onclick = onClick
  }
  return notification
}

function shouldDeliverNotification(
  eventType: NotificationType,
  prefs: NotificationPreferences
): { desktop: boolean; inApp: boolean } {
  // Master toggle off = no notifications
  if (!prefs.master) {
    return { desktop: false, inApp: false }
  }

  const mode = prefs[eventType]
  return {
    desktop: mode === 'desktop',
    inApp: mode === 'desktop' || mode === 'in-app'
  }
}

export function useDesktopNotifications(): void {
  const tasks = useSprintTasks((s) => s.tasks)
  const prMergedMap = useSprintTasks((s) => s.prMergedMap)
  const addNotification = useNotificationsStore((s) => s.addNotification)
  const setView = usePanelLayoutStore((s) => s.setView)

  const prevTasksRef = useRef<Map<string, SprintTask>>(new Map())
  const prevPrMergedRef = useRef<Record<string, boolean>>({})
  const initializedRef = useRef(false)
  const notifiedTasksRef = useRef<Set<string>>(new Set())
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    master: true,
    agent_completed: 'desktop',
    agent_failed: 'desktop',
    pr_merged: 'desktop',
    pr_closed: 'in-app',
    merge_conflict: 'desktop'
  })

  // Load notification preferences
  useEffect(() => {
    const loadPreferences = async (): Promise<void> => {
      const loaded: Partial<NotificationPreferences> = {}

      try {
        const master = await window.api.settings.get('notifications.master')
        loaded.master = typeof master === 'boolean' ? master : true

        const events: Array<keyof Omit<NotificationPreferences, 'master'>> = [
          'agent_completed',
          'agent_failed',
          'pr_merged',
          'pr_closed',
          'merge_conflict'
        ]

        for (const event of events) {
          const value = await window.api.settings.get(`notifications.${event}`)
          if (value === 'desktop' || value === 'in-app' || value === 'off') {
            loaded[event] = value
          }
        }
      } catch {
        // Use defaults
      }

      setPrefs((prev) => ({ ...prev, ...loaded }))
    }

    loadPreferences()
  }, [])

  // Request permission on mount
  useEffect(() => {
    requestPermissionOnce()
  }, [])

  // Watch for task status changes
  useEffect(() => {
    if (!prefs.master) return

    const prevMap = prevTasksRef.current
    const currentMap = new Map(tasks.map((t) => [t.id, t]))

    // Skip initial render — seed without notifying
    if (!initializedRef.current) {
      prevTasksRef.current = currentMap
      initializedRef.current = true
      return
    }

    const handleNotificationClick = (): void => {
      window.focus()
      setView('code-review')
    }

    for (const task of tasks) {
      const prev = prevMap.get(task.id)
      if (!prev) continue

      // Skip if we already notified for this task
      if (notifiedTasksRef.current.has(task.id)) continue

      const windowNotFocused = !shouldNotify()

      // Agent completed: active → review
      if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.REVIEW) {
        if (!shouldNotify()) continue

        const delivery = shouldDeliverNotification('agent_completed', prefs)
        if (!delivery.desktop && !delivery.inApp) continue
        if (delivery.desktop && windowNotFocused) continue

        const title = 'BDE: Task Ready for Review'
        const message = `${task.title}`

        if (delivery.inApp) {
          addNotification({
            type: 'agent_completed',
            title,
            message,
            viewLink: `/sprint/${task.id}`
          })
        }

        if (delivery.desktop) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }

        if (shouldNotify()) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }
        fireDesktopNotification(title, message, handleNotificationClick)
        notifiedTasksRef.current.add(task.id)
      }

      // Agent completed: active → done
      if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.DONE) {
        const delivery = shouldDeliverNotification('agent_completed', prefs)
        if (!delivery.desktop && !delivery.inApp) continue

        const title = 'BDE: Task Completed'
        const message = task.pr_url ? `${task.title} — PR ready` : `${task.title}`

        // Always show in-app notifications
        if (delivery.inApp) {
          addNotification({
            type: 'agent_completed',
            title,
            message,
            viewLink: `/sprint/${task.id}`
          })
        }

        // Only show desktop notifications when window is not focused
        if (delivery.desktop && !document.hasFocus()) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }

        if (shouldNotify()) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }
        fireDesktopNotification(title, message, handleNotificationClick)
        notifiedTasksRef.current.add(task.id)
      }

      // Agent failed: active → failed
      if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.FAILED) {
        const delivery = shouldDeliverNotification('agent_failed', prefs)
        if (!delivery.desktop && !delivery.inApp) continue

        const title = 'BDE: Task Failed'
        const message = `${task.title}`

        // Always show in-app notifications
        if (delivery.inApp) {
          addNotification({
            type: 'agent_failed',
            title,
            message,
            viewLink: `/sprint/${task.id}`
          })
        }

        // Only show desktop notifications when window is not focused
        if (delivery.desktop && !document.hasFocus()) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }
        notifiedTasksRef.current.add(task.id)
      }

      // Agent error: active → error
      if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.ERROR) {
        if (!shouldNotify()) continue

        const delivery = shouldDeliverNotification('agent_failed', prefs)
        if (!delivery.desktop && !delivery.inApp) continue
        if (delivery.desktop && windowNotFocused) continue

        const title = 'BDE: Task Error'
        const message = `${task.title}`

        if (delivery.inApp) {
          addNotification({
            type: 'agent_failed',
            title,
            message,
            viewLink: `/sprint/${task.id}`
          })
        }

        if (delivery.desktop) {
          fireDesktopNotification(title, message, handleNotificationClick)
        }
        notifiedTasksRef.current.add(task.id)
      }
    }

    prevTasksRef.current = currentMap
  }, [tasks, addNotification, prefs, setView])

  // Watch for PR merged events
  useEffect(() => {
    if (!prefs.master) return

    const prev = prevPrMergedRef.current

    const handleNotificationClick = (): void => {
      window.focus()
      setView('code-review')
    }

    const windowNotFocused = !shouldNotify()

    for (const [taskId, merged] of Object.entries(prMergedMap)) {
      // Skip if already merged in previous state
      if (prev[taskId] === merged) continue
      // Only fire if newly merged
      if (!merged) continue
      // Skip if we already notified
      if (notifiedTasksRef.current.has(`${taskId}-merged`)) continue

      const task = tasks.find((t) => t.id === taskId)
      if (!task) continue

      const delivery = shouldDeliverNotification('pr_merged', prefs)
      if (!delivery.desktop && !delivery.inApp) continue
      if (delivery.desktop && windowNotFocused) continue

      const title = 'BDE: PR Merged'
      const message = `${task.title} — PR #${task.pr_number || 'unknown'} merged`

      if (delivery.inApp) {
        addNotification({
          type: 'pr_merged',
          title,
          message,
          viewLink: task.pr_url || undefined
        })
      }

      if (delivery.desktop) {
        fireDesktopNotification(title, message, handleNotificationClick)
      }

      if (shouldNotify()) {
        fireDesktopNotification(title, message, handleNotificationClick)
      }
      fireDesktopNotification(title, message, handleNotificationClick)
      notifiedTasksRef.current.add(`${taskId}-merged`)
    }

    prevPrMergedRef.current = prMergedMap
  }, [prMergedMap, tasks, addNotification, prefs, setView])
}
