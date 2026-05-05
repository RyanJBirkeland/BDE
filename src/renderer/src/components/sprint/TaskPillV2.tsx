import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useNow } from '../../hooks/useNow'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useSprintTasks } from '../../stores/sprintTasks'
import { PriorityChip } from './primitives/PriorityChip'
import { Tag } from '../ui/Tag'

const textPretty = { textWrap: 'pretty' } as React.CSSProperties

interface TaskPillV2Props {
  task: SprintTask
  selected: boolean
  multiSelected?: boolean | undefined
  onClick: (id: string) => void
}

function contextualRightTag(task: SprintTask): React.ReactNode {
  if (
    task.status === 'review' ||
    task.pr_status === 'open' ||
    task.pr_status === 'branch_only'
  ) {
    if (task.pr_number) {
      return (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--st-review)',
            flexShrink: 0,
          }}
        >
          #{task.pr_number}
        </span>
      )
    }
  }
  if (task.status === 'blocked' && task.depends_on?.length) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--st-blocked)',
          flexShrink: 0,
        }}
      >
        ↳ {task.depends_on[0]?.id.substring(0, 6)}
      </span>
    )
  }
  if (task.status === 'done' && task.completed_at) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-4)',
          flexShrink: 0,
        }}
      >
        {formatElapsed(task.completed_at)}
      </span>
    )
  }
  return null
}

interface LiveAgentBlockProps {
  task: SprintTask
  elapsed: string
  now: number
}

// Only place in this file where .fleet-pulse appears — active tasks only.
function LiveAgentBlock({ task, elapsed, now }: LiveAgentBlockProps): React.JSX.Element {
  const pct =
    task.started_at && task.max_runtime_ms
      ? Math.min(
          95,
          Math.round(
            ((now - new Date(task.started_at).getTime()) / task.max_runtime_ms) * 100
          )
        )
      : 0

  return (
    <div
      style={{
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        padding: 'var(--s-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-2)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {elapsed || task.title.substring(0, 24)}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{ height: 2, background: 'var(--surf-3)', borderRadius: 1, overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--st-running)',
            transition: 'width 0.5s ease',
          }}
        />
      </div>
    </div>
  )
}

function TaskPillV2Inner({
  task,
  selected,
  multiSelected,
  onClick,
}: TaskPillV2Props): React.JSX.Element {
  const [elapsed, setElapsed] = useState('')
  const now = useNow()

  const blockingTitles = useSprintTasks(
    useCallback(
      (s) => {
        if (task.status !== 'blocked' || !task.depends_on?.length) return null
        return task.depends_on
          .map((d) => s.tasks.find((t) => t.id === d.id)?.title ?? d.id)
          .join(', ')
      },
      [task.status, task.depends_on]
    )
  )

  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setElapsed(formatElapsed(task.started_at!)), isActive ? 10_000 : null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: seed elapsed string once on first active render
    if (isActive) setElapsed(formatElapsed(task.started_at!))
  }, [isActive, task.started_at])

  const toggleTaskSelection = useSprintSelection((s) => s.toggleTaskSelection)
  const clearSelection = useSprintSelection((s) => s.clearSelection)

  const handleClick = (e: React.MouseEvent): void => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault()
      toggleTaskSelection(task.id)
    } else {
      clearSelection()
      onClick(task.id)
    }
  }

  return (
    <motion.div
      layoutId={task.id}
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}, status: ${task.status}`}
      title={blockingTitles ? `Blocked by: ${blockingTitles}` : undefined}
      data-testid="task-pill"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            toggleTaskSelection(task.id)
          } else {
            onClick(task.id)
          }
        }
      }}
      transition={SPRINGS.default}
      style={{
        padding: 'var(--s-2) var(--s-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        background: selected || multiSelected ? 'var(--surf-2)' : 'var(--bg)',
        border:
          selected || multiSelected
            ? '1px solid var(--line-2)'
            : '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        textAlign: 'left',
        opacity: task.status === 'done' ? 0.7 : 1,
        minWidth: 0,
      }}
    >
      {/* Top meta row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-4)',
            flexShrink: 0,
          }}
        >
          {task.id.substring(0, 8)}
        </span>
        {task.priority != null && <PriorityChip priority={task.priority} />}
        <span style={{ flex: 1 }} />
        {contextualRightTag(task)}
      </div>

      {/* Title */}
      <span
        style={{
          fontSize: 12,
          color: 'var(--fg)',
          lineHeight: 1.4,
          ...textPretty,
        }}
      >
        {task.title}
      </span>

      {/* Live agent block — only for active tasks */}
      {task.status === 'active' && <LiveAgentBlock task={task} elapsed={elapsed} now={now} />}

      {/* Bottom row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          minWidth: 0,
        }}
      >
        {task.tags && task.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-4)',
            flexShrink: 0,
          }}
        >
          {task.repo}
        </span>
      </div>
    </motion.div>
  )
}

export const TaskPillV2 = React.memo(TaskPillV2Inner)
TaskPillV2.displayName = 'TaskPillV2'
