import './PipelineGlanceCard.css'
import React, { useMemo } from 'react'
import { Card } from '../primitives/Card'
import { CardHead } from '../primitives/CardHead'
import { buildStageCells } from './pipeline-glance-cells'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'
import type { DashboardStats } from '../../../lib/dashboard-types'

interface PipelineGlanceCardProps {
  partitions: SprintPartition
  stats: DashboardStats
  onOpenPipeline: () => void
}

function PipelineGlanceCardComponent({
  partitions,
  stats,
  onOpenPipeline
}: PipelineGlanceCardProps): React.JSX.Element {
  const total =
    partitions.todo.length +
    partitions.inProgress.length +
    partitions.pendingReview.length +
    partitions.done.length
  const stages = useMemo(() => buildStageCells(partitions, stats), [partitions, stats])

  return (
    <Card>
      <CardHead
        eyebrow="Pipeline"
        title={`Today's flow · ${total}`}
        live
        right={
          <button className="pipeline-glance__mini-link" onClick={onOpenPipeline}>
            Open Pipeline →
          </button>
        }
      />
      {/* Flow bar */}
      <div className="pipeline-glance__flow-bar">
        {stages.map((s) => (
          <div
            key={s.key}
            style={{ flex: Math.max(s.count, 0.5), background: `var(--st-${s.key})`, opacity: 0.85 }}
          />
        ))}
      </div>
      {/* 4-up grid */}
      <div className="pipeline-glance__grid">
        {stages.map((s) => (
          <div key={s.key} className="pipeline-glance__cell" onClick={onOpenPipeline}>
            <div className="pipeline-glance__label-row">
              <span className={`fleet-dot fleet-dot--${s.key}`} />
              <span className="fleet-eyebrow">{s.label}</span>
            </div>
            <span className="pipeline-glance__count">{s.count}</span>
            <span className="pipeline-glance__peek">{s.peek}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export const PipelineGlanceCard = React.memo(PipelineGlanceCardComponent)
