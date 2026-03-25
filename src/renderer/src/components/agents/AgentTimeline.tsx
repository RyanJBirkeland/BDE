import { useMemo } from 'react'
import type { AgentMeta } from '../../../../shared/types'
import { TimelineBar } from './TimelineBar'

interface AgentTimelineProps {
  agents: AgentMeta[]
  onSelectAgent: (id: string) => void
}

export function AgentTimeline({ agents, onSelectAgent }: AgentTimelineProps): JSX.Element {
  // Default time range: last 6 hours
  const timeRange = useMemo(() => {
    const now = Date.now()
    const sixHoursAgo = now - 6 * 3600 * 1000
    return { start: sixHoursAgo, end: now }
  }, [])

  // Filter agents to those within the time range
  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const startTime = new Date(agent.startedAt).getTime()
      const endTime = agent.finishedAt ? new Date(agent.finishedAt).getTime() : Date.now()

      // Include if there's any overlap with the time range
      return endTime >= timeRange.start && startTime <= timeRange.end
    })
  }, [agents, timeRange])

  // Generate time axis labels (every hour)
  const timeLabels = useMemo(() => {
    const labels: Array<{ label: string; percent: number }> = []
    const spanMs = timeRange.end - timeRange.start
    const hourMs = 3600 * 1000

    // Start from the first hour mark after timeRange.start
    const startHour = Math.ceil(timeRange.start / hourMs) * hourMs

    for (let t = startHour; t <= timeRange.end; t += hourMs) {
      const percent = ((t - timeRange.start) / spanMs) * 100
      const date = new Date(t)
      const label = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        hour12: true
      })
      labels.push({ label, percent })
    }

    return labels
  }, [timeRange])

  const handleBarClick = (agentId: string): void => {
    onSelectAgent(agentId)
  }

  return (
    <div className="agent-timeline">
      <div className="agent-timeline__canvas" style={{ minWidth: '100%' }}>
        {filteredAgents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => handleBarClick(agent.id)}
            style={{ cursor: 'pointer' }}
          >
            <TimelineBar
              agent={agent}
              timeRange={timeRange}
              totalWidth={1000}
            />
          </div>
        ))}

        {/* Time axis labels */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '16px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          {timeLabels.map((tick, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${tick.percent}%`,
                fontSize: '10px',
                color: 'rgba(255, 255, 255, 0.3)',
                transform: 'translateX(-50%)',
                fontFamily: 'var(--bde-font-code)'
              }}
            >
              {tick.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
