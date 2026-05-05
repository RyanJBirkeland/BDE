import React, { useRef, useState, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { useSprintUI } from '../../stores/sprintUI'
import { WIP_LIMIT_IN_PROGRESS } from '../../lib/constants'
import { StatusDot } from '../ui/StatusDot'
import type { StatusDotKind } from '../ui/StatusDot'
import { TaskPillV2 } from './TaskPillV2'
import { TaskRowV2 } from './TaskRowV2'

interface PipelineStageV2Props {
  name: 'queued' | 'blocked' | 'active' | 'review' | 'open-prs' | 'done'
  label: string
  tasks: SprintTask[]
  count: string
  selectedTaskId: string | null
  selectedTaskIds?: Set<string> | undefined
  onTaskClick: (id: string) => void
  doneFooter?: React.ReactNode | undefined
}

const STAGE_VISIBLE_LIMIT = 20

const STAGE_DOT_KIND: Record<PipelineStageV2Props['name'], StatusDotKind> = {
  queued: 'queued',
  blocked: 'blocked',
  active: 'running',
  review: 'review',
  'open-prs': 'review',
  done: 'done',
}

function PipelineStageV2Inner({
  name,
  label,
  tasks,
  count,
  selectedTaskId,
  selectedTaskIds,
  onTaskClick,
  doneFooter,
}: PipelineStageV2Props): React.JSX.Element {
  const empty = tasks.length === 0 && !doneFooter
  const cardsRef = useRef<HTMLDivElement>(null)
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const [expanded, setExpanded] = useState(false)

  const visibleTasks = useMemo(
    () => (expanded ? tasks : tasks.slice(0, STAGE_VISIBLE_LIMIT)),
    [tasks, expanded]
  )
  const hiddenCount = tasks.length - STAGE_VISIBLE_LIMIT

  const handleStageKeyDown = (e: React.KeyboardEvent): void => {
    const cards = cardsRef.current?.querySelectorAll(
      '[role="button"], button'
    ) as NodeListOf<HTMLElement>
    if (!cards?.length) return
    const currentIndex = Array.from(cards).indexOf(document.activeElement as HTMLElement)
    if (currentIndex === -1) return

    let nextIndex = currentIndex
    switch (e.key) {
      case 'ArrowDown':
        nextIndex = Math.min(currentIndex + 1, cards.length - 1)
        break
      case 'ArrowUp':
        nextIndex = Math.max(currentIndex - 1, 0)
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = cards.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    cards[nextIndex]?.focus()
  }

  return (
    <div
      style={{
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
      data-testid={`pipeline-stage-${name}`}
      role="region"
      aria-label={label}
    >
      {/* Stage head — 40px */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-2) var(--s-3)',
          borderBottom: '1px solid var(--line)',
          height: 40,
          flexShrink: 0,
        }}
      >
        <StatusDot kind={STAGE_DOT_KIND[name]} size={6} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--fg)',
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color:
              name === 'active' && tasks.length > WIP_LIMIT_IN_PROGRESS
                ? 'var(--st-failed)'
                : 'var(--fg-3)',
          }}
        >
          {count}
        </span>
      </div>

      {/* Stage body */}
      <div
        style={{
          padding: 'var(--s-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s-2)',
          overflowY: 'auto',
          flex: 1,
        }}
        ref={cardsRef}
        onKeyDown={handleStageKeyDown}
      >
        {empty ? (
          <div
            style={{
              border: '1px dashed var(--line)',
              borderRadius: 'var(--r-md)',
              padding: 'var(--s-3)',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}
            >
              —
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {visibleTasks.map((task) =>
              pipelineDensity === 'compact' ? (
                <TaskRowV2
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  onClick={onTaskClick}
                />
              ) : (
                <TaskPillV2
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  multiSelected={selectedTaskIds?.has(task.id)}
                  onClick={onTaskClick}
                />
              )
            )}
          </AnimatePresence>
        )}

        {!expanded && hiddenCount > 0 && (
          <button
            className="pipeline-stage__show-more"
            onClick={() => setExpanded(true)}
          >
            Show {hiddenCount} more
          </button>
        )}
        {expanded && tasks.length > STAGE_VISIBLE_LIMIT && (
          <button
            className="pipeline-stage__show-more"
            onClick={() => setExpanded(false)}
          >
            Show less
          </button>
        )}
        {doneFooter}
      </div>
    </div>
  )
}

export const PipelineStageV2 = React.memo(PipelineStageV2Inner)
PipelineStageV2.displayName = 'PipelineStageV2'
