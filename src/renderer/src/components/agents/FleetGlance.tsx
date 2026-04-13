/**
 * FleetGlance — overview of running agents and recent completions when no agent is selected.
 */
import { useMemo } from 'react'
import { Loader, CheckCircle, XCircle, DollarSign, Clock } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { formatDuration, formatElapsed, timeAgo } from '../../lib/format'
import './FleetGlance.css'

interface FleetGlanceProps {
  agents: AgentMeta[]
  onSelect: (id: string) => void
}

export function FleetGlance({ agents, onSelect }: FleetGlanceProps): React.JSX.Element {
  const {
    running,
    doneToday,
    failedToday,
    todayCost,
    todayRuntime,
    runningAgents,
    recentCompletions
  } = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayStartMs = todayStart.getTime()

    const runningList = agents.filter((a) => a.status === 'running')
    const todayAgents = agents.filter(
      (a) => a.finishedAt && new Date(a.finishedAt).getTime() >= todayStartMs
    )

    const doneCount = todayAgents.filter((a) => a.status === 'done').length
    const failedCount = todayAgents.filter(
      (a) => a.status === 'failed' || a.status === 'cancelled'
    ).length

    const totalCost = todayAgents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)

    const totalRuntime = todayAgents.reduce((sum, a) => {
      if (!a.finishedAt) return sum
      const duration = new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()
      return sum + duration
    }, 0)

    const recent = agents
      .filter((a) => a.status === 'done' || a.status === 'failed' || a.status === 'cancelled')
      .sort((a, b) => {
        const aFinished = a.finishedAt ? new Date(a.finishedAt).getTime() : 0
        const bFinished = b.finishedAt ? new Date(b.finishedAt).getTime() : 0
        return bFinished - aFinished
      })
      .slice(0, 5)

    return {
      running: runningList.length,
      doneToday: doneCount,
      failedToday: failedCount,
      todayCost: totalCost,
      todayRuntime: totalRuntime,
      runningAgents: runningList.slice(0, 5),
      recentCompletions: recent
    }
  }, [agents])

  const formatCost = (usd: number): string => `$${usd.toFixed(2)}`
  const formatRuntimeMs = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  const truncateTask = (task: string, maxLen: number): string =>
    task.length > maxLen ? `${task.slice(0, maxLen)}…` : task

  return (
    <div className="fleet-glance">
      {/* Fleet status row */}
      <div className="fleet-glance__status-row">
        <div className="fleet-glance__stat">
          <Loader size={16} className="fleet-glance__stat-icon fleet-glance__stat-icon--running" />
          <span className="fleet-glance__stat-label">Running</span>
          <span className="fleet-glance__stat-value">{running}</span>
        </div>
        <div className="fleet-glance__stat">
          <CheckCircle
            size={16}
            className="fleet-glance__stat-icon fleet-glance__stat-icon--done"
          />
          <span className="fleet-glance__stat-label">Done</span>
          <span className="fleet-glance__stat-value">{doneToday}</span>
        </div>
        <div className="fleet-glance__stat">
          <XCircle size={16} className="fleet-glance__stat-icon fleet-glance__stat-icon--failed" />
          <span className="fleet-glance__stat-label">Failed</span>
          <span className="fleet-glance__stat-value">{failedToday}</span>
        </div>
        <div className="fleet-glance__stat">
          <DollarSign size={16} className="fleet-glance__stat-icon fleet-glance__stat-icon--cost" />
          <span className="fleet-glance__stat-label">Today</span>
          <span className="fleet-glance__stat-value">{formatCost(todayCost)}</span>
        </div>
        <div className="fleet-glance__stat">
          <Clock size={16} className="fleet-glance__stat-icon fleet-glance__stat-icon--runtime" />
          <span className="fleet-glance__stat-label">Runtime</span>
          <span className="fleet-glance__stat-value">{formatRuntimeMs(todayRuntime)}</span>
        </div>
      </div>

      {/* What's happening now */}
      {runningAgents.length > 0 && (
        <div className="fleet-glance__section">
          <h3 className="fleet-glance__section-title">What&apos;s happening now</h3>
          <div className="fleet-glance__list">
            {runningAgents.map((agent) => {
              const elapsed = formatElapsed(new Date(agent.startedAt).getTime())
              return (
                <button
                  key={agent.id}
                  className="fleet-glance__item"
                  onClick={() => onSelect(agent.id)}
                >
                  <span className="fleet-glance__status-dot fleet-glance__status-dot--running" />
                  <span className="fleet-glance__task">{truncateTask(agent.task, 60)}</span>
                  <span className="fleet-glance__hint">▶ running</span>
                  <span className="fleet-glance__duration">{elapsed}</span>
                  <span className="fleet-glance__cost">{formatCost(agent.costUsd ?? 0)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent completions */}
      {recentCompletions.length > 0 && (
        <div className="fleet-glance__section">
          <h3 className="fleet-glance__section-title">Recent completions</h3>
          <div className="fleet-glance__list">
            {recentCompletions.map((agent) => {
              const duration = formatDuration(agent.startedAt, agent.finishedAt)
              const ago = agent.finishedAt ? timeAgo(agent.finishedAt) : ''
              const Icon =
                agent.status === 'done'
                  ? CheckCircle
                  : agent.status === 'failed'
                    ? XCircle
                    : XCircle
              const iconClass =
                agent.status === 'done'
                  ? 'fleet-glance__completion-icon--done'
                  : 'fleet-glance__completion-icon--failed'

              return (
                <button
                  key={agent.id}
                  className="fleet-glance__item"
                  onClick={() => onSelect(agent.id)}
                >
                  <Icon size={16} className={`fleet-glance__completion-icon ${iconClass}`} />
                  <span className="fleet-glance__task">{truncateTask(agent.task, 60)}</span>
                  <span className="fleet-glance__duration">{duration}</span>
                  <span className="fleet-glance__cost">{formatCost(agent.costUsd ?? 0)}</span>
                  <span className="fleet-glance__ago">{ago}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state if no running or completed agents */}
      {runningAgents.length === 0 && recentCompletions.length === 0 && (
        <div className="fleet-glance__empty">
          <p>No agents running or completed today.</p>
          <p className="fleet-glance__empty-hint">
            Click the <strong>+</strong> button to spawn a new agent.
          </p>
        </div>
      )}
    </div>
  )
}
