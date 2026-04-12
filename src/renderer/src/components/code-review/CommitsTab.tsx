import { GitCommit } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewCommits } from '../../hooks/useReviewCommits'

export function CommitsTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)

  const { commits, loading } = useReviewCommits(selectedTaskId)

  if (loading) {
    return (
      <div
        className="cr-commits"
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}
      >
        <div className="bde-skeleton" style={{ height: 48 }} />
        <div className="bde-skeleton" style={{ height: 48 }} />
        <div className="bde-skeleton" style={{ height: 48 }} />
      </div>
    )
  }
  if (commits.length === 0) return <EmptyState message="No commits found on this branch." />

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
