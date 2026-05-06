import './AttentionCard.css'
import React, { useCallback } from 'react'
import { Card } from '../primitives/Card'
import { CardHead } from '../primitives/CardHead'
import { formatDurationMs } from '../../../lib/format'
import type { AttentionItem } from '../hooks/useDashboardData'

interface AttentionCardProps {
  items: AttentionItem[]
  totalCount: number
  onOpenPipeline: (filter: 'failed' | 'blocked') => void
  onOpenReview: () => void
  onRetryTask: (taskId: string) => Promise<void>
}

interface AttentionRowProps {
  item: AttentionItem
  first: boolean
  onAction: (item: AttentionItem) => void
}

const AttentionRow = React.memo(function AttentionRow({
  item,
  first,
  onAction
}: AttentionRowProps): React.JSX.Element {
  const age = formatDurationMs(item.ageMs)
  const handleClick = useCallback(() => onAction(item), [onAction, item])
  return (
    <div
      className="attention__row"
      style={{ borderTop: first ? 'none' : '1px solid var(--line)' }}
    >
      <span className={`fleet-dot fleet-dot--${item.kind}`} />
      <div className="attention__text-col">
        <span className="attention__title">{item.task.title}</span>
        <span className="attention__sub">{item.sub}</span>
      </div>
      <span className="attention__age">{age}</span>
      <button className="attention__action-btn" onClick={handleClick}>
        {item.action}
      </button>
    </div>
  )
})

export function AttentionCard({
  items,
  totalCount,
  onOpenPipeline,
  onOpenReview,
  onRetryTask
}: AttentionCardProps): React.JSX.Element | null {
  const handleAction = useCallback(
    (item: AttentionItem) => {
      if (item.action === 'Restart') {
        onRetryTask(item.task.id).catch(() => {})
      } else if (item.action === 'Review') {
        onOpenReview()
      } else {
        onOpenPipeline(item.kind === 'failed' ? 'failed' : 'blocked')
      }
    },
    [onRetryTask, onOpenReview, onOpenPipeline]
  )

  const handleViewAll = useCallback(() => onOpenPipeline('failed'), [onOpenPipeline])

  if (items.length === 0) return null

  return (
    <Card attention>
      <CardHead
        eyebrow="Attention"
        title={`${items.length} need you`}
        eyebrowColor="var(--st-failed)"
        right={
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--st-failed)'
            }}
          >
            ranked by age × severity
          </span>
        }
      />
      <div>
        {items.map((item, i) => (
          <AttentionRow key={item.task.id} item={item} first={i === 0} onAction={handleAction} />
        ))}
      </div>
      {totalCount > items.length && (
        <button className="attention__view-all" onClick={handleViewAll}>
          View all ({totalCount}) →
        </button>
      )}
    </Card>
  )
}
