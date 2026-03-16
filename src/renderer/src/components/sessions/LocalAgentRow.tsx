import { useState, useEffect } from 'react'
import type { LocalAgentProcess } from '../../stores/localAgents'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { cwdToRepoLabel } from '../../lib/utils'
import { formatElapsed } from '../../lib/format'

function useElapsed(startedAt: number): string {
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])
  return formatElapsed(startedAt)
}

export function LocalAgentRow({
  process: proc
}: {
  process: LocalAgentProcess
}): React.JSX.Element {
  const elapsed = useElapsed(proc.startedAt)
  const repoLabel = cwdToRepoLabel(proc.cwd)
  const selectedPid = useLocalAgentsStore((s) => s.selectedLocalAgentPid)
  const selectLocalAgent = useLocalAgentsStore((s) => s.selectLocalAgent)
  const isSelected = selectedPid === proc.pid

  return (
    <button
      className={`local-agent-row ${isSelected ? 'local-agent-row--selected' : ''}`}
      title={proc.args || undefined}
      onClick={() => selectLocalAgent(proc.pid)}
    >
      <span className="local-agent-row__icon">⬡</span>
      <span className="local-agent-row__bin">{proc.bin}</span>
      <span className="local-agent-row__repo">~/{repoLabel}</span>
      <span className="local-agent-row__elapsed">{elapsed}</span>
      <span className="local-agent-row__pid">pid {proc.pid}</span>
    </button>
  )
}
