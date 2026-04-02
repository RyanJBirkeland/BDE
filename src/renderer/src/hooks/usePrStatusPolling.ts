/**
 * usePrStatusPolling — polls GitHub PR statuses for tasks with a pr_url.
 * Detects merge conflicts, updates pr_status/pr_mergeable_state in the store,
 * and fires immediate polls when tasks transition from active to done.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import { useSprintTasks } from '../stores/sprintTasks'
import { usePrConflictsStore } from '../stores/prConflicts'
import { toast } from '../stores/toasts'
import { POLL_PR_STATUS_MS } from '../lib/constants'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'

export function usePrStatusPolling(): void {
  const tasks = useSprintTasks((s) => s.tasks)
  const prMergedMap = useSprintTasks((s) => s.prMergedMap)
  const updateTask = useSprintTasks((s) => s.updateTask)
  const setPrMergedMap = useSprintTasks((s) => s.setPrMergedMap)

  const prMergedRef = useRef(prMergedMap)
  prMergedRef.current = prMergedMap
  const updateTaskRef = useRef(updateTask)
  updateTaskRef.current = updateTask

  const setConflicts = usePrConflictsStore((s) => s.setConflicts)
  const prevConflictIdsRef = useRef<Set<string>>(new Set())
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const pollPrStatuses = useCallback(
    async (taskList: SprintTask[]) => {
      const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
      if (withPr.length === 0) return
      try {
        const results = await window.api.pollPrStatuses(
          withPr.map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
        )
        setPrMergedMap((prev) => {
          let changed = false
          for (const r of results) {
            if (prev[r.taskId] !== r.merged) {
              changed = true
              break
            }
          }
          if (!changed) return prev
          const next = { ...prev }
          for (const r of results) next[r.taskId] = r.merged
          return next
        })
        // Write pr_status='merged' back so tasks leave Awaiting Review
        for (const r of results) {
          if (r.merged) updateTaskRef.current(r.taskId, { pr_status: PR_STATUS.MERGED })
        }

        // Track merge conflicts
        const conflicting = results.filter((r) => r.mergeableState === 'dirty' && !r.merged)
        const conflictIds = conflicting.map((r) => r.taskId)
        setConflicts(conflictIds)

        // Toast when NEW conflicts appear
        const prev = prevConflictIdsRef.current
        const newConflicts = conflictIds.filter((id) => !prev.has(id))
        if (newConflicts.length > 0) {
          toast.error(
            `${newConflicts.length} PR${newConflicts.length > 1 ? 's have' : ' has'} merge conflicts`
          )
        }
        prevConflictIdsRef.current = new Set(conflictIds)

        // Persist mergeable state to SQLite
        for (const r of results) {
          if (r.mergeableState) {
            updateTaskRef.current(r.taskId, {
              pr_mergeable_state: r.mergeableState as SprintTask['pr_mergeable_state']
            })
          }
        }
      } catch {
        // gh CLI unavailable — degrade gracefully
      }
    },
    [setConflicts, setPrMergedMap]
  )

  const pollPrStatusesCurrent = useCallback(
    () => pollPrStatuses(tasksRef.current),
    [pollPrStatuses]
  )
  useEffect(() => {
    pollPrStatusesCurrent()
  }, [pollPrStatusesCurrent])
  useVisibilityAwareInterval(pollPrStatusesCurrent, POLL_PR_STATUS_MS)

  // Detect active->done transitions and trigger immediate PR poll
  const prevTasksRef = useRef<SprintTask[]>([])
  useEffect(() => {
    const prev = prevTasksRef.current
    prevTasksRef.current = tasks
    if (prev.length === 0) return
    const justDone = tasks.filter(
      (t) =>
        t.status === TASK_STATUS.DONE &&
        t.pr_url &&
        prev.find((p) => p.id === t.id)?.status === TASK_STATUS.ACTIVE
    )
    if (justDone.length > 0) pollPrStatuses(justDone)
  }, [tasks, pollPrStatuses])
}
