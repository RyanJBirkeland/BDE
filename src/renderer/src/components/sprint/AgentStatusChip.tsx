import { ElapsedTime } from '../ui/ElapsedTime'
import { AGENT_STATUS } from '../../../../shared/constants'

type AgentStatus = 'idle' | 'running' | 'done' | 'error'

type AgentStatusChipProps = {
  status: AgentStatus
  startedAt: string | number | null
}

export function AgentStatusChip({ status, startedAt }: AgentStatusChipProps) {
  const startMs = startedAt
    ? typeof startedAt === 'string'
      ? new Date(startedAt).getTime()
      : startedAt
    : null

  return (
    <span className={`agent-chip agent-chip--${status}`}>
      <span className="agent-chip__dot" />
      {status === AGENT_STATUS.RUNNING && startMs != null ? (
        <ElapsedTime startedAtMs={startMs} />
      ) : status === AGENT_STATUS.DONE ? (
        'Done'
      ) : status === AGENT_STATUS.ERROR ? (
        'Error'
      ) : (
        'Idle'
      )}
    </span>
  )
}
