import { useEffect, useRef } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { SESSION_ACTIVE_THRESHOLD } from '../lib/constants'
import { subscribeSSE, type LogDoneEvent, type TaskUpdatedEvent } from '../lib/taskRunnerSSE'
import { toast } from '../stores/toasts'
import type { SprintTask } from '../../../shared/types'

// --- LogDrawer awareness (module-level so SSE handlers can read it) ---

let _openLogDrawerTaskId: string | null = null

/** Call from SprintCenter whenever logDrawerTaskId changes. */
export function setOpenLogDrawerTaskId(id: string | null): void {
  _openLogDrawerTaskId = id
}

// --- Shared dedup — single source of truth across all notification sources ---

const MAX_SEEN_IDS = 500

const notifiedTaskIds = new Set<string>()

function boundSet(set: Set<string>, maxSize: number): void {
  if (set.size <= maxSize) return
  const excess = set.size - maxSize
  let removed = 0
  for (const key of set) {
    if (removed >= excess) break
    set.delete(key)
    removed++
  }
}

/** @internal — exported for testing only */
export function _resetNotifiedTaskIds(): void {
  notifiedTaskIds.clear()
}

export function notifyOnce(taskId: string, title: string, body: string): boolean {
  if (notifiedTaskIds.has(taskId)) return false
  notifiedTaskIds.add(taskId)
  boundSet(notifiedTaskIds, MAX_SEEN_IDS)
  notify(title, body)
  return true
}

// --- Helpers ---

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

function requestPermissionOnce(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function useTaskNotifications(): void {
  const seenDoneIds = useRef<Set<string>>(new Set())
  const seenBlockedKeys = useRef<Set<string>>(new Set())
  const seenLogDoneIds = useRef<Set<string>>(new Set())
  const seenPrTaskIds = useRef<Set<string>>(new Set())
  const initialized = useRef(false)
  const sessions = useSessionsStore((s) => s.sessions)

  // Request notification permission on mount
  useEffect(() => {
    requestPermissionOnce()
  }, [])

  // Watch for blocked sessions
  useEffect(() => {
    for (const session of sessions) {
      const fiveMinAgo = Date.now() - SESSION_ACTIVE_THRESHOLD
      const isRunning = session.updatedAt > fiveMinAgo
      if (session.abortedLastRun && !isRunning && !seenBlockedKeys.current.has(session.key)) {
        seenBlockedKeys.current.add(session.key)
        boundSet(seenBlockedKeys.current, MAX_SEEN_IDS)
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
          boundSet(seenDoneIds.current, MAX_SEEN_IDS)
          initialized.current = true
          return
        }

        for (const task of doneTasks) {
          if (!seenDoneIds.current.has(task.id)) {
            seenDoneIds.current.add(task.id)
            boundSet(seenDoneIds.current, MAX_SEEN_IDS)
            const body = task.pr_url
              ? `PR ready: ${task.pr_url}`
              : `Task "${task.title}" completed in ${task.repo}.`
            notifyOnce(task.id, '\u2705 Agent task done', body)
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

  // Watch for agent done/failed via SSE log:done events
  useEffect(() => {
    const unsub = subscribeSSE('log:done', (data: unknown) => {
      const event = data as LogDoneEvent
      if (seenLogDoneIds.current.has(event.taskId)) return
      seenLogDoneIds.current.add(event.taskId)
      boundSet(seenLogDoneIds.current, MAX_SEEN_IDS)

      // Skip notification if user is watching this task's LogDrawer
      if (_openLogDrawerTaskId === event.taskId) return

      // Use shared dedup — if Source 1 already fired, this is a no-op
      if (event.exitCode === 0) {
        notifyOnce(event.taskId, 'Agent finished', 'Task completed successfully.')
      } else {
        notifyOnce(event.taskId, 'Agent failed', `Exit code ${event.exitCode}`)
      }
    })
    return unsub
  }, [])

  // Watch for PR opened via SSE task:updated events
  useEffect(() => {
    const unsub = subscribeSSE('task:updated', (data: unknown) => {
      const update = data as TaskUpdatedEvent
      const prUrl = update.pr_url as string | undefined
      if (!prUrl || seenPrTaskIds.current.has(update.id)) return
      seenPrTaskIds.current.add(update.id)
      boundSet(seenPrTaskIds.current, MAX_SEEN_IDS)

      // Skip if user is watching this task
      if (_openLogDrawerTaskId === update.id) return

      const title = (update.title as string) || 'Sprint task'
      notify('PR opened', `${title}\n${prUrl}`)
    })
    return unsub
  }, [])
}

// ---------------------------------------------------------------------------
// useTaskToasts — in-app toast notifications for task state transitions
// ---------------------------------------------------------------------------

const TOAST_DURATION = 6000

/**
 * Fires in-app toasts when:
 * 1. A task transitions to done (from any non-done status)
 * 2. A task gains a pr_url (was null, now populated)
 *
 * Skips the initial render (seeding) and tasks whose LogDrawer is open.
 */
export function useTaskToasts(
  tasks: SprintTask[],
  logDrawerTaskId: string | null,
  onViewOutput: (task: SprintTask) => void
): void {
  const prevMapRef = useRef<Map<string, SprintTask>>(new Map())
  const initializedRef = useRef(false)
  // Stable ref so the effect doesn't re-run when the callback identity changes
  const onViewOutputRef = useRef(onViewOutput)
  onViewOutputRef.current = onViewOutput

  useEffect(() => {
    const prevMap = prevMapRef.current
    const currentMap = new Map(tasks.map((t) => [t.id, t]))

    // Seed on first render — don't fire toasts for pre-existing state
    if (!initializedRef.current) {
      prevMapRef.current = currentMap
      initializedRef.current = true
      return
    }

    for (const task of tasks) {
      const prev = prevMap.get(task.id)
      if (!prev) continue

      // Skip if the user is already watching this task's output
      if (logDrawerTaskId === task.id) continue

      // 1. Agent finished: non-done → done
      if (prev.status !== 'done' && task.status === 'done') {
        if (notifiedTaskIds.has(task.id)) continue // OS notification already fired
        const captured = task
        toast.info(`Agent finished: ${task.title}`, {
          action: 'View Output',
          onAction: () => onViewOutputRef.current(captured),
          durationMs: TOAST_DURATION,
        })
      }

      // 2. PR opened: pr_url went from null → non-null
      if (!prev.pr_url && task.pr_url) {
        const url = task.pr_url
        toast.info(`PR opened: ${task.title}`, {
          action: 'Open PR',
          onAction: () => window.open(url, '_blank'),
          durationMs: TOAST_DURATION,
        })
      }
    }

    prevMapRef.current = currentMap
  }, [tasks, logDrawerTaskId])
}
