import { useState, useRef, useEffect } from 'react'
import type { AgentMeta } from '../../../../shared/types'

interface TimelineBarProps {
  agent: AgentMeta
  timeRange: { start: number; end: number }
  totalWidth: number
}

export function TimelineBar({ agent, timeRange, totalWidth }: TimelineBarProps): JSX.Element | null {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  const startTime = new Date(agent.startedAt).getTime()
  const endTime = agent.finishedAt ? new Date(agent.finishedAt).getTime() : Date.now()

  // Only render if the agent overlaps with the time range
  if (endTime < timeRange.start || startTime > timeRange.end) {
    return null
  }

  const timeSpan = timeRange.end - timeRange.start
  const clampedStart = Math.max(startTime, timeRange.start)
  const clampedEnd = Math.min(endTime, timeRange.end)

  const leftPercent = ((clampedStart - timeRange.start) / timeSpan) * 100
  const widthPercent = ((clampedEnd - clampedStart) / timeSpan) * 100

  // Compute duration for tooltip
  const durationMs = endTime - startTime
  const durationSec = Math.floor(durationMs / 1000)
  const durationMin = Math.floor(durationSec / 60)
  const durationHr = Math.floor(durationMin / 60)

  let durationStr: string
  if (durationHr > 0) {
    durationStr = `${durationHr}h ${durationMin % 60}m`
  } else if (durationMin > 0) {
    durationStr = `${durationMin}m ${durationSec % 60}s`
  } else {
    durationStr = `${durationSec}s`
  }

  // Determine CSS class based on status
  const statusClass = `timeline-bar--${agent.status}`

  const handleMouseEnter = (e: React.MouseEvent): void => {
    setShowTooltip(true)
    updateTooltipPosition(e)
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    updateTooltipPosition(e)
  }

  const handleMouseLeave = (): void => {
    setShowTooltip(false)
  }

  const updateTooltipPosition = (e: React.MouseEvent): void => {
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        ref={barRef}
        className={`timeline-bar ${statusClass}`}
        style={{
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          top: '20px'
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {showTooltip && (
        <div
          className="timeline-bar__tooltip"
          style={{
            left: tooltipPos.x + 10,
            top: tooltipPos.y - 30
          }}
        >
          <div style={{ fontWeight: 700 }}>{agent.task || agent.id}</div>
          <div style={{ opacity: 0.7 }}>
            {durationStr} • {agent.status}
          </div>
        </div>
      )}
    </>
  )
}
