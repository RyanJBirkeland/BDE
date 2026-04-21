import React, { useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { TaskPill } from './TaskPill'
import { TaskRow } from './TaskRow'
import { useSprintUI } from '../../stores/sprintUI'
import type { SprintTask } from '../../../../shared/types'

import './PipelineStage.css'

interface PipelineStageProps {
  name: 'queued' | 'blocked' | 'active' | 'review' | 'done'
  label: string
  tasks: SprintTask[]
  count: string
  selectedTaskId: string | null
  selectedTaskIds?: Set<string> | undefined
  onTaskClick: (id: string) => void
  doneFooter?: React.ReactNode | undefined
}

const STAGE_VISIBLE_LIMIT = 20

function PipelineStageInner({
  name,
  label,
  tasks,
  count,
  selectedTaskId,
  selectedTaskIds,
  onTaskClick,
  doneFooter
}: PipelineStageProps): React.JSX.Element {
  const empty = tasks.length === 0 && !doneFooter
  const cardsRef = useRef<HTMLDivElement>(null)
  const pipelineDensity = useSprintUI((s) => s.pipelineDensity)
  const [expanded, setExpanded] = useState(false)
  const visibleTasks = expanded ? tasks : tasks.slice(0, STAGE_VISIBLE_LIMIT)
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
      className={`pipeline-stage${empty ? ' pipeline-stage--empty' : ''}`}
      data-testid={`pipeline-stage-${name}`}
      role="region"
      aria-label={label}
    >
      <div
        className={`pipeline-stage__dot pipeline-stage__dot--${name}${empty ? ' pipeline-stage__dot--dim' : ''}`}
      >
        {tasks.length}
      </div>
      <div className="pipeline-stage__header">
        <div className={`pipeline-stage__name pipeline-stage__name--${name}`}>{label}</div>
        {!empty && <div className="pipeline-stage__count">{count}</div>}
        {label === 'Review' && tasks.length > 0 && (
          <span className="pipeline-stage__subtitle">PRs awaiting merge</span>
        )}
      </div>
      {!empty && (
        <div className="pipeline-stage__cards" ref={cardsRef} onKeyDown={handleStageKeyDown}>
          <AnimatePresence mode="popLayout">
            {visibleTasks.map((task) =>
              pipelineDensity === 'compact' ? (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  onClick={onTaskClick}
                />
              ) : (
                <TaskPill
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  multiSelected={selectedTaskIds?.has(task.id)}
                  onClick={onTaskClick}
                />
              )
            )}
          </AnimatePresence>
          {!expanded && hiddenCount > 0 && (
            <button className="pipeline-stage__show-more" onClick={() => setExpanded(true)}>
              Show {hiddenCount} more
            </button>
          )}
          {expanded && tasks.length > STAGE_VISIBLE_LIMIT && (
            <button className="pipeline-stage__show-more" onClick={() => setExpanded(false)}>
              Show less
            </button>
          )}
          {doneFooter}
        </div>
      )}
    </div>
  )
}

export const PipelineStage = React.memo(PipelineStageInner)
PipelineStage.displayName = 'PipelineStage'
