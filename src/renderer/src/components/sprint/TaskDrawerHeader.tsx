import React from 'react'
import type { SprintTask } from '../../../../shared/types'
import type { TaskStatus } from '../../../../shared/task-state-machine'
import { statusToDotKind } from '../../lib/task-status'
import { StatusDot } from '../ui/StatusDot'
import { PriorityChip } from './primitives/PriorityChip'
import { Tag } from '../ui/Tag'

interface TaskDrawerHeaderProps {
  task: SprintTask
  titleRef: React.RefObject<HTMLParagraphElement | null>
  titleId: string
  onClose: () => void
}

function colorForTaskStatus(status: TaskStatus): string {
  switch (status) {
    case 'active':
      return 'var(--st-running)'
    case 'blocked':
      return 'var(--st-blocked)'
    case 'review':
    case 'approved':
      return 'var(--st-review)'
    case 'done':
      return 'var(--st-done)'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'var(--st-failed)'
    default:
      return 'var(--fg-3)'
  }
}

export function TaskDrawerHeader({
  task,
  titleRef,
  titleId,
  onClose
}: TaskDrawerHeaderProps): React.JSX.Element {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: 'var(--bg)',
        padding: 'var(--s-3) var(--s-4)',
        borderBottom: '1px solid var(--line)'
      }}
    >
      <TopMetaRow task={task} onClose={onClose} />
      <TaskTitle task={task} titleRef={titleRef} titleId={titleId} />
      <TagRow task={task} />
    </div>
  )
}

// --- Private sub-components ---

interface TopMetaRowProps {
  task: SprintTask
  onClose: () => void
}

function TopMetaRow({ task, onClose }: TopMetaRowProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        minWidth: 0,
        marginBottom: 'var(--s-1)'
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
        {task.id.substring(0, 8)}
      </span>
      {task.priority != null && <PriorityChip priority={task.priority} />}
      <StatusIndicator task={task} />
      <span style={{ flex: 1 }} />
      <button
        onClick={onClose}
        aria-label="Close task details"
        style={{
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          borderRadius: 'var(--r-sm)',
          fontSize: 14
        }}
      >
        ×
      </button>
    </div>
  )
}

function StatusIndicator({ task }: { task: SprintTask }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'var(--s-1)' }}>
      {task.status === 'active' ? (
        <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
      ) : (
        <StatusDot kind={statusToDotKind(task.status, task.pr_status)} size={6} />
      )}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: colorForTaskStatus(task.status as TaskStatus)
        }}
      >
        {task.status}
      </span>
    </div>
  )
}

interface TaskTitleProps {
  task: SprintTask
  titleRef: React.RefObject<HTMLParagraphElement | null>
  titleId: string
}

const textPretty = { textWrap: 'pretty' } as React.CSSProperties

function TaskTitle({ task, titleRef, titleId }: TaskTitleProps): React.JSX.Element {
  return (
    <p
      ref={titleRef}
      id={titleId}
      tabIndex={-1}
      style={{
        fontSize: 15,
        fontWeight: 500,
        color: 'var(--fg)',
        lineHeight: 1.4,
        margin: '0 0 var(--s-1) 0',
        ...textPretty
      }}
    >
      {task.title}
    </p>
  )
}

function TagRow({ task }: { task: SprintTask }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        flexWrap: 'wrap',
        minWidth: 0
      }}
    >
      {task.tags?.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-3)'
        }}
      >
        {task.repo}
      </span>
    </div>
  )
}
