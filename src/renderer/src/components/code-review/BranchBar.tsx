import { GitBranch, ArrowRight } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  branch: string
  targetBranch?: string | undefined
}

export function BranchBar({ branch, targetBranch = 'main' }: Props): JSX.Element {
  return (
    <div className="cr-branchbar" aria-label={`Branch ${branch} targeting ${targetBranch}`}>
      <GitBranch size={14} />
      <span className="cr-branchbar__branch">{branch}</span>
      <ArrowRight size={12} />
      <span className="cr-branchbar__target">{targetBranch}</span>
    </div>
  )
}
