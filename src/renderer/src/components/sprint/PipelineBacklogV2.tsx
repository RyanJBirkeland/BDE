import React, { useState } from 'react'
import { Inbox } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { EmptyState } from '../ui/EmptyState'
import { Tag } from '../ui/Tag'
import { PriorityChip } from './primitives/PriorityChip'

interface PipelineBacklogV2Props {
  backlog: SprintTask[]
  failed: SprintTask[]
  selectedTaskIds: Set<string>
  onToggleTaskSelection: (taskId: string) => void
  onTaskClick: (id: string) => void
  onAddToQueue: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
  onClearFailures: () => void
  onRequeueAllFailed: () => void
}

const FAILED_VISIBLE_LIMIT = 3
const BACKLOG_VISIBLE_LIMIT = 40

interface TriageCardProps {
  task: SprintTask
  isSelected: boolean
  selectionAccentColor: string
  testId: string
  onCardClick: () => void
  onDoubleClick?: ((e: React.MouseEvent) => void) | undefined
  doubleClickTitle?: string | undefined
  children: React.ReactNode
  actions?: React.ReactNode | undefined
  showCheckbox?: boolean | undefined
  onToggleSelection?: (() => void) | undefined
}

function TriageCard({
  task,
  isSelected,
  selectionAccentColor,
  testId,
  onCardClick,
  onDoubleClick,
  doubleClickTitle,
  children,
  actions,
  showCheckbox,
  onToggleSelection
}: TriageCardProps): React.JSX.Element {
  return (
    <div style={{ position: 'relative' }}>
      {isSelected && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: selectionAccentColor,
            borderRadius: '0 2px 2px 0'
          }}
        />
      )}
      {showCheckbox && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation()
            onToggleSelection?.()
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${task.title}`}
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 1,
            cursor: 'pointer',
            opacity: isSelected ? 1 : 0,
            pointerEvents: 'auto'
          }}
        />
      )}
      <button
        style={{
          width: '100%',
          padding: 'var(--s-2)',
          borderRadius: 'var(--r-md)',
          background: isSelected ? 'var(--surf-2)' : 'transparent',
          border: isSelected ? '1px solid var(--line-2)' : '1px solid transparent',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s-1)'
        }}
        aria-label={`Select task: ${task.title}`}
        onClick={onCardClick}
        onDoubleClick={onDoubleClick}
        title={doubleClickTitle}
        data-testid={testId}
      >
        {children}
      </button>
      {actions}
    </div>
  )
}

interface ShowMoreButtonProps {
  count: number
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  label: string
}

function ShowMoreButton({ count, expanded, onExpand, onCollapse, label }: ShowMoreButtonProps): React.JSX.Element | null {
  const SHOW_MORE_STYLE: React.CSSProperties = {
    width: '100%',
    padding: 'var(--s-2)',
    border: '1px dashed var(--line-2)',
    borderRadius: 'var(--r-md)',
    background: 'transparent',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--fg-3)',
    cursor: 'pointer',
    marginTop: 'var(--s-1)'
  }
  if (!expanded && count > 0) {
    return (
      <button
        onClick={onExpand}
        aria-expanded={false}
        aria-label={`Show ${count} more ${label} tasks`}
        style={SHOW_MORE_STYLE}
      >
        + {count} more{label === 'backlog' ? ' in backlog' : ''}
      </button>
    )
  }
  if (expanded && count > 0) {
    return (
      <button
        onClick={onCollapse}
        aria-expanded={true}
        aria-label={`Show fewer ${label} tasks`}
        style={SHOW_MORE_STYLE}
      >
        Show less
      </button>
    )
  }
  return null
}

function BacklogCard({
  task,
  isSelected,
  onTaskClick,
  onToggleTaskSelection,
  onAddToQueue
}: {
  task: SprintTask
  isSelected: boolean
  onTaskClick: (id: string) => void
  onToggleTaskSelection: (id: string) => void
  onAddToQueue: (task: SprintTask) => void
}): React.JSX.Element {
  return (
    <TriageCard
      task={task}
      isSelected={isSelected}
      selectionAccentColor="var(--accent)"
      testId={`backlog-card-${task.id}`}
      onCardClick={() => onTaskClick(task.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onAddToQueue(task)
      }}
      doubleClickTitle="Double-click to add to queue"
      showCheckbox
      onToggleSelection={() => onToggleTaskSelection(task.id)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)', flexShrink: 0 }}>
          {task.id.substring(0, 8)}
        </span>
        {task.priority != null && <PriorityChip priority={task.priority} />}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)', flexShrink: 0 }}>
          {task.repo}
        </span>
      </div>
      <span
        style={
          {
            fontSize: 12,
            color: 'var(--fg)',
            lineHeight: 1.35,
            textWrap: 'pretty'
          } as React.CSSProperties
        }
      >
        {task.title}
      </span>
      {task.tags && task.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {task.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      )}
    </TriageCard>
  )
}

function FailedCard({
  task,
  isSelected,
  onTaskClick,
  onRerun
}: {
  task: SprintTask
  isSelected: boolean
  onTaskClick: (id: string) => void
  onRerun: (task: SprintTask) => void
}): React.JSX.Element {
  return (
    <TriageCard
      task={task}
      isSelected={isSelected}
      selectionAccentColor="var(--st-failed)"
      testId={`failed-card-${task.id}`}
      onCardClick={() => onTaskClick(task.id)}
      actions={
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRerun(task)
          }}
          aria-label={`Re-run ${task.title}`}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 22,
            padding: '0 var(--s-2)',
            border: '1px solid var(--line)',
            background: 'transparent',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-2)',
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          ↻ Re-run
        </button>
      }
    >
      <span
        style={
          {
            fontSize: 12,
            color: 'var(--fg)',
            lineHeight: 1.35,
            textWrap: 'pretty'
          } as React.CSSProperties
        }
      >
        {task.title}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--st-failed)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        ✗ {task.notes ?? 'No details'}
      </span>
    </TriageCard>
  )
}

function PipelineBacklogV2Inner({
  backlog,
  failed,
  selectedTaskIds,
  onToggleTaskSelection,
  onTaskClick,
  onAddToQueue,
  onRerun,
  onClearFailures,
  onRequeueAllFailed
}: PipelineBacklogV2Props): React.JSX.Element {
  const [failedExpanded, setFailedExpanded] = useState(false)
  const [backlogExpanded, setBacklogExpanded] = useState(false)

  const visibleFailed = failedExpanded ? failed : failed.slice(0, FAILED_VISIBLE_LIMIT)
  const hiddenFailedCount = failed.length - FAILED_VISIBLE_LIMIT
  const visibleBacklog = backlogExpanded ? backlog : backlog.slice(0, BACKLOG_VISIBLE_LIMIT)
  const hiddenBacklogCount = backlog.length - BACKLOG_VISIBLE_LIMIT

  return (
    <div
      className="pipeline-sidebar"
      style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--bg)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
      data-testid="pipeline-backlog"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: 'var(--s-3) var(--s-3) var(--s-2)',
            borderBottom: '1px solid var(--line)'
          }}
        >
          <span className="fleet-eyebrow">TRIAGE</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>Backlog</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--fg-3)',
                marginLeft: 'auto'
              }}
            >
              {backlog.length}
            </span>
          </div>
        </div>

        <div
          style={{
            padding: 'var(--s-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-1)',
            flex: 1
          }}
        >
          {visibleBacklog.map((task) => (
            <BacklogCard
              key={task.id}
              task={task}
              isSelected={selectedTaskIds.has(task.id)}
              onTaskClick={onTaskClick}
              onToggleTaskSelection={onToggleTaskSelection}
              onAddToQueue={onAddToQueue}
            />
          ))}

          <ShowMoreButton
            count={hiddenBacklogCount}
            expanded={backlogExpanded}
            onExpand={() => setBacklogExpanded(true)}
            onCollapse={() => setBacklogExpanded(false)}
            label="backlog"
          />

          {backlog.length === 0 && (
            <EmptyState
              icon={<Inbox size={24} />}
              title="No backlog tasks"
              description="Tasks will appear here when you add them to the sprint backlog"
            />
          )}
        </div>
      </div>

      {failed.length > 0 && (
        <div
          style={{ borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: 'var(--s-3) var(--s-3) var(--s-2)' }}>
            <span className="fleet-eyebrow">NEEDS ATTENTION</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', marginTop: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>Failed</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--st-failed)',
                  marginLeft: 'auto'
                }}
              >
                {failed.length}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-1)', marginTop: 'var(--s-2)' }}>
              <button
                onClick={onRequeueAllFailed}
                aria-label="Requeue all failed tasks"
                style={{
                  flex: 1,
                  height: 22,
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  borderRadius: 'var(--r-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--fg-2)',
                  cursor: 'pointer'
                }}
              >
                ↻ Requeue all
              </button>
              <button
                onClick={onClearFailures}
                aria-label="Clear all failed tasks"
                style={{
                  flex: 1,
                  height: 22,
                  border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)',
                  background: 'transparent',
                  borderRadius: 'var(--r-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--st-failed)',
                  cursor: 'pointer'
                }}
              >
                ✕ Clear
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '0 var(--s-2) var(--s-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--s-1)'
            }}
          >
            {visibleFailed.map((task) => (
              <FailedCard
                key={task.id}
                task={task}
                isSelected={selectedTaskIds.has(task.id)}
                onTaskClick={onTaskClick}
                onRerun={onRerun}
              />
            ))}

            <ShowMoreButton
              count={hiddenFailedCount}
              expanded={failedExpanded}
              onExpand={() => setFailedExpanded(true)}
              onCollapse={() => setFailedExpanded(false)}
              label="failed"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export const PipelineBacklogV2 = React.memo(PipelineBacklogV2Inner)
PipelineBacklogV2.displayName = 'PipelineBacklogV2'
