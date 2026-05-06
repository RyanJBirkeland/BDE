import './PipelineGlanceCard.css'
import React, { useMemo } from 'react'
import { Card } from '../primitives/Card'
import { CardHead } from '../primitives/CardHead'
import { timeAgo } from '../../../lib/format'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'
import type { DashboardStats } from '../../../lib/dashboard-types'

interface PipelineGlanceCardProps {
  partitions: SprintPartition
  stats: DashboardStats
  onOpenPipeline: () => void
}

export interface StageCell {
  key: string
  label: string
  count: number
  peek: string
}

export function buildStageCells(partitions: SprintPartition, stats: DashboardStats): StageCell[] {
  const oldestActive = partitions.inProgress[partitions.inProgress.length - 1]
  const oldestReview = partitions.pendingReview[partitions.pendingReview.length - 1]
  return [
    {
      key: 'queued',
      label: 'Queued',
      count: partitions.todo.length,
      peek: partitions.todo[0] ? `next: ${partitions.todo[0].title}` : 'queue is empty'
    },
    {
      key: 'running',
      label: 'Running',
      count: partitions.inProgress.length,
      peek: oldestActive
        ? `oldest: ${oldestActive.title} · ${timeAgo(oldestActive.started_at ?? Date.now())}`
        : 'none active'
    },
    {
      key: 'review',
      label: 'Review',
      count: partitions.pendingReview.length,
      peek: oldestReview?.promoted_to_review_at
        ? `oldest: ${timeAgo(oldestReview.promoted_to_review_at)} waiting`
        : 'none pending'
    },
    {
      key: 'done',
      label: 'Done',
      count: partitions.done.length,
      peek: `+${stats.doneToday} today`
    }
  ]
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
