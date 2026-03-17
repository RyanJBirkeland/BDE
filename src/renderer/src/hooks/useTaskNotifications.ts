import { useEffect, useRef } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { SESSION_ACTIVE_THRESHOLD } from '../lib/constants'
import type { SprintTask } from '../../../shared/types'

function notify(title: string, body: string): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification(title, { body, silent: false })
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') new Notification(title, { body })
    })
  }
}

export function useTaskNotifications(): void {
  const seenDoneIds = useRef<Set<string>>(new Set())
  const seenBlockedKeys = useRef<Set<string>>(new Set())
  const initialized = useRef(false)
  const sessions = useSessionsStore((s) => s.sessions)

  // Watch for blocked sessions
  useEffect(() => {
    for (const session of sessions) {
      const fiveMinAgo = Date.now() - SESSION_ACTIVE_THRESHOLD
      const isRunning = session.updatedAt > fiveMinAgo
      if (session.abortedLastRun && !isRunning && !seenBlockedKeys.current.has(session.key)) {
        seenBlockedKeys.current.add(session.key)
        notify(
          '\u26A0\uFE0F Agent needs attention',
          `Session "${session.displayName || session.key}" aborted and may need input.`
        )
      }
      // Clear from seen if it starts running again
      if (isRunning && seenBlockedKeys.current.has(session.key)) {
        seenBlockedKeys.current.delete(session.key)
      }
    }
  }, [sessions])

  // Watch for completed sprint tasks via local SQLite change events
  useEffect(() => {
    const handleChange = async (): Promise<void> => {
      try {
        const tasks = (await window.api.sprint.list()) as SprintTask[]
        const doneTasks = tasks.filter((t) => t.status === 'done')

        // On first event, seed seenDoneIds without notifying
        if (!initialized.current) {
          for (const t of doneTasks) seenDoneIds.current.add(t.id)
          initialized.current = true
          return
        }

        for (const task of doneTasks) {
          if (!seenDoneIds.current.has(task.id)) {
            seenDoneIds.current.add(task.id)
            const body = task.pr_url
              ? `PR ready: ${task.pr_url}`
              : `Task "${task.title}" completed in ${task.repo}.`
            notify('\u2705 Agent task done', body)
          }
        }
      } catch {
        // Silently ignore — non-critical feature
      }
    }

    // Seed seen IDs on mount
    handleChange()

    window.api.onExternalSprintChange(handleChange)
    return () => window.api.offExternalSprintChange(handleChange)
  }, [])
}
