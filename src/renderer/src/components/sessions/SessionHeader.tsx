import { AgentSession, SubAgent } from '../../stores/sessions'
import { Badge } from '../ui/Badge'
import { timeAgo, modelBadgeLabel, shortKey } from '../../lib/format'

const FIVE_MINUTES = 5 * 60 * 1000

interface SessionHeaderProps {
  session: AgentSession | null
  subAgent: SubAgent | null
}

export function SessionHeader({ session, subAgent }: SessionHeaderProps): React.JSX.Element | null {
  if (!session && !subAgent) return null

  const isSubAgentView = subAgent !== null
  const model = isSubAgentView ? subAgent.model : session!.model
  const updatedAt = isSubAgentView ? subAgent.startedAt : session!.updatedAt

  // Status dot
  const isRunning = isSubAgentView
    ? subAgent.isActive
    : Date.now() - session!.updatedAt < FIVE_MINUTES
  const isBlocked = !isSubAgentView && session!.abortedLastRun && !isRunning

  let dotClass = 'session-header__dot'
  if (isRunning) dotClass += ' session-header__dot--running'
  if (isBlocked) dotClass += ' session-header__dot--blocked'

  // Label
  const label = isSubAgentView
    ? <>
        <span className="session-header__breadcrumb">main</span>
        <span className="session-header__separator">{' \u203A '}</span>
        <span>{subAgent.label}</span>
      </>
    : <span>{session!.displayName || shortKey(session!.key)}</span>

  return (
    <div className="session-header">
      <span className={dotClass} />
      <span className="session-header__label">{label}</span>
      <Badge variant="muted" size="sm">{modelBadgeLabel(model)}</Badge>
      {isSubAgentView && (
        <Badge variant="muted" size="sm">sub-agent</Badge>
      )}
      <span className="session-header__time">{timeAgo(updatedAt)}</span>
    </div>
  )
}
