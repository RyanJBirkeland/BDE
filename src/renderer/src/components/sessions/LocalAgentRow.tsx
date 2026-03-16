import { useState, useEffect } from 'react'
import type { LocalAgentProcess } from '../../stores/localAgents'

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function cwdToRepoLabel(cwd: string | null): string {
  if (!cwd) return 'unknown'
  const parts = cwd.split('/')
  const repoIdx = parts.indexOf('Repositories')
  if (repoIdx !== -1) return parts[repoIdx + 1] ?? parts[parts.length - 1]
  const worktreeIdx = parts.indexOf('worktrees')
  if (worktreeIdx !== -1) return parts.slice(worktreeIdx + 1).join('/')
  return parts[parts.length - 1]
}

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

  return (
    <div className="local-agent-row" title={proc.args || undefined}>
      <span className="local-agent-row__icon">⬡</span>
      <span className="local-agent-row__bin">{proc.bin}</span>
      <span className="local-agent-row__repo">~/{repoLabel}</span>
      <span className="local-agent-row__elapsed">{elapsed}</span>
      <span className="local-agent-row__pid">pid {proc.pid}</span>
    </div>
  )
}
