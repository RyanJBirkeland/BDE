import { useEffect } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { GitCommit } from 'lucide-react'

export function CommitsTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const commits = useCodeReviewStore((s) => s.commits)
  const setCommits = useCodeReviewStore((s) => s.setCommits)
  const setLoading = useCodeReviewStore((s) => s.setLoading)
  const loading = useCodeReviewStore((s) => s.loading)
  const tasks = useSprintTasks((s) => s.tasks)

  const task = tasks.find((t) => t.id === selectedTaskId)

  useEffect(() => {
    if (!task?.worktree_path) return
    setLoading('commits', true)
    window.api.review
      .getCommits({ worktreePath: task.worktree_path, base: 'origin/main' })
      .then((result) => setCommits(result.commits))
      .catch(() => setCommits([]))
      .finally(() => setLoading('commits', false))
  }, [task?.worktree_path, task?.id, setCommits, setLoading])

  if (loading.commits) return <div className="cr-placeholder">Loading commits...</div>
  if (commits.length === 0) return <div className="cr-placeholder">No commits found</div>

  return (
    <div className="cr-commits">
      {commits.map((commit) => (
        <div key={commit.hash} className="cr-commits__item">
          <GitCommit size={14} className="cr-commits__icon" />
          <div className="cr-commits__body">
            <span className="cr-commits__message">{commit.message}</span>
            <span className="cr-commits__meta">
              {commit.hash.slice(0, 7)} · {commit.author} ·{' '}
              {new Date(commit.date).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
