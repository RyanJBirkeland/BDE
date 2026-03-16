import { useEffect, useRef } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { SESSION_ACTIVE_THRESHOLD, POLL_SPRINT_INTERVAL } from '../lib/constants'

const SUPABASE_URL = 'https://ponbudosprotfhissvzo.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvbmJ1ZG9zcHJvdGZoaXNzdnpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkyNzgsImV4cCI6MjA4ODEzNTI3OH0.KwALcQ9P404nMKyx76Jz7UA9QEQsDn2UFWw8mAb_ZNI'

interface SprintTask {
  id: string
  title: string
  repo: string
  status: 'queued' | 'active' | 'done'
  updated_at: string
  pr_url: string | null
}

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
          '⚠️ Agent needs attention',
          `Session "${session.displayName || session.key}" aborted and may need input.`
        )
      }
      // Clear from seen if it starts running again
      if (isRunning && seenBlockedKeys.current.has(session.key)) {
        seenBlockedKeys.current.delete(session.key)
      }
    }
  }, [sessions])

  // Watch for completed sprint tasks
  useEffect(() => {
    const fetchDone = async (): Promise<void> => {
      try {
        // Only look at tasks completed in the last 5 minutes
        const since = new Date(Date.now() - SESSION_ACTIVE_THRESHOLD).toISOString()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/sprint_tasks?status=eq.done&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.desc&limit=10`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            }
          }
        )
        const tasks: SprintTask[] = await res.json()

        // On first load, seed seenDoneIds without notifying (avoid notifying on app start)
        if (!initialized.current) {
          for (const t of tasks) seenDoneIds.current.add(t.id)
          initialized.current = true
          return
        }

        for (const task of tasks) {
          if (!seenDoneIds.current.has(task.id)) {
            seenDoneIds.current.add(task.id)
            const body = task.pr_url
              ? `PR ready: ${task.pr_url}`
              : `Task "${task.title}" completed in ${task.repo}.`
            notify('✅ Agent task done', body)
          }
        }
      } catch {
        // Silently ignore — non-critical feature
      }
    }

    fetchDone()
    const id = setInterval(fetchDone, POLL_SPRINT_INTERVAL)
    return () => clearInterval(id)
  }, [])
}
