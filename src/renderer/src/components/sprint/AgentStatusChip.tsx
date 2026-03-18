import { ElapsedTime } from '../ui/ElapsedTime'

type AgentStatus = 'idle' | 'running' | 'done' | 'error'

type AgentStatusChipProps = {
  status: AgentStatus
  startedAt: string | number | null
}

export function AgentStatusChip({ status, startedAt }: AgentStatusChipProps) {
  const startMs = startedAt
    ? typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt
    : null

  return (
    <span className={`agent-chip agent-chip--${status}`}>
      <span className="agent-chip__dot" />
      {status === 'running' && startMs != null
        ? <ElapsedTime startedAtMs={startMs} />
        : status === 'done'
          ? 'Done'
          : status === 'error'
            ? 'Error'
            : 'Idle'}
    </span>
  )
}
