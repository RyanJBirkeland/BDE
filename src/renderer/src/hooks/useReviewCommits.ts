import { useEffect, useState } from 'react'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import type { ReviewCommit } from '../stores/codeReview'

export interface ReviewCommitsResult {
  commits: ReviewCommit[]
  loading: boolean
  error: string | null
}

export function useReviewCommits(taskId: string | null): ReviewCommitsResult {
  const tasks = useSprintTasks((s) => s.tasks)
  const setCommits = useCodeReviewStore((s) => s.setCommits)
  const setLoading = useCodeReviewStore((s) => s.setLoading)

  const [error, setError] = useState<string | null>(null)

  const task = tasks.find((t) => t.id === taskId)

  useEffect(() => {
    let cancelled = false

    if (!task?.worktree_path) {
      setCommits([])
      return
    }

    const worktreePath = task.worktree_path

    void (async () => {
      setLoading('commits', true)
      setError(null)

      try {
        const result = await window.api.review.getCommits({
          worktreePath,
          base: 'origin/main'
        })
        if (!cancelled) setCommits(result.commits)
      } catch (err) {
        if (!cancelled) {
          setCommits([])
          setError(err instanceof Error ? err.message : 'Failed to load commits')
        }
      } finally {
        if (!cancelled) setLoading('commits', false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [task?.worktree_path, task?.id, setCommits, setLoading])

  return {
    commits: useCodeReviewStore((s) => s.commits),
    loading: useCodeReviewStore((s) => s.loading.commits ?? false),
    error
  }
}
