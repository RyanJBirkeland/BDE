import { AlertTriangle, Check } from 'lucide-react'
import type { JSX } from 'react'

export type FileReviewStatus = 'clean' | 'issues' | 'unreviewed'

export function AIFileStatusBadge({ status }: { status: FileReviewStatus }): JSX.Element | null {
  if (status === 'unreviewed') return null

  if (status === 'issues') {
    return (
      <span role="img" aria-label="File has issues" className="cr-ai-status cr-ai-status--issues">
        <AlertTriangle size={10} />
      </span>
    )
  }

  return (
    <span role="img" aria-label="File reviewed clean" className="cr-ai-status cr-ai-status--clean">
      <Check size={10} />
    </span>
  )
}
