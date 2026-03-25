import React, { useState, useRef, useEffect } from 'react'
import { ArrowRight, Eye, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { tokens } from '../../design-system/tokens'
import { timeAgo, formatDate, repoBadgeVariant } from '../../lib/format'
import type { SprintTask } from '../../../../shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskRowVariant = 'backlog' | 'done' | 'failed' | 'blocked'

export interface SprintTaskRowProps {
  /** The task data to display */
  task: SprintTask

  /** Visual variant - determines which columns and actions to show */
  variant: TaskRowVariant

  /** Whether the row is selected (for bulk operations) */
  selected?: boolean

  /** Whether the row is dimmed (e.g., for failed/cancelled tasks) */
  dimmed?: boolean

  // Action handlers (optional - only provided ones will show)
  onViewSpec?: (task: SprintTask) => void
  onViewOutput?: (task: SprintTask) => void
  onPushToSprint?: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onRerun?: (task: SprintTask) => void
  onUpdatePriority?: (patch: { id: string; priority: number }) => void
  onEditInWorkbench?: (task: SprintTask) => void
  onClick?: (task: SprintTask) => void
}

// ---------------------------------------------------------------------------
// Priority Options
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { value: 1, label: 'P1 Critical' },
  { value: 2, label: 'P2 High' },
  { value: 3, label: 'P3 Medium' },
  { value: 4, label: 'P4 Low' },
  { value: 5, label: 'P5 Backlog' },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priorityVariant(priority: number): 'danger' | 'warning' | 'muted' {
  if (priority <= 1) return 'danger'
  if (priority <= 3) return 'warning'
  return 'muted'
}

function priorityDotColor(priority: number): string {
  const variant = priorityVariant(priority)
  if (variant === 'danger') return tokens.color.danger
  if (variant === 'warning') return tokens.color.warning
  return tokens.color.textMuted
}

// ---------------------------------------------------------------------------
// Priority Popover Component
// ---------------------------------------------------------------------------

interface PriorityPopoverProps {
  task: SprintTask
  onUpdate?: (patch: { id: string; priority: number }) => void
  onClose: () => void
}

function PriorityPopover({ task, onUpdate, onClose }: PriorityPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: tokens.space[1],
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        boxShadow: tokens.shadow.md,
        zIndex: 100,
        minWidth: '140px',
      }}
    >
      {PRIORITY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            if (opt.value !== task.priority && onUpdate) {
              onUpdate({ id: task.id, priority: opt.value })
            }
            onClose()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            width: '100%',
            padding: `${tokens.space[2]} ${tokens.space[3]}`,
            border: 'none',
            background: opt.value === task.priority ? tokens.color.surfaceHigh : 'transparent',
            color: tokens.color.text,
            fontSize: tokens.size.sm,
            fontFamily: tokens.font.ui,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            if (opt.value !== task.priority) {
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }
          }}
          onMouseLeave={(e) => {
            if (opt.value !== task.priority) {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: priorityDotColor(opt.value),
              flexShrink: 0,
            }}
          />
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SprintTaskRow({
  task,
  variant,
  selected = false,
  dimmed = false,
  onViewSpec,
  onViewOutput,
  onPushToSprint,
  onMarkDone,
  onRerun,
  onUpdatePriority,
  onEditInWorkbench,
  onClick,
}: SprintTaskRowProps): React.ReactElement {
  const [popoverOpen, setPopoverOpen] = useState(false)

  const handleRowClick = () => {
    if (onClick) {
      onClick(task)
    } else if (onViewSpec) {
      onViewSpec(task)
    }
  }

  // Base row styles
  const rowStyle: React.CSSProperties = {
    display: 'contents',
    cursor: onClick || onViewSpec ? 'pointer' : 'default',
  }

  // Cell styles
  const cellStyle: React.CSSProperties = {
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    fontSize: tokens.size.sm,
    fontFamily: tokens.font.ui,
    color: dimmed ? tokens.color.textMuted : tokens.color.text,
    borderBottom: `1px solid ${tokens.color.border}`,
  }

  const titleCellStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 500,
  }

  const dateCellStyle: React.CSSProperties = {
    ...cellStyle,
    color: tokens.color.textMuted,
    fontSize: tokens.size.xs,
    fontFamily: tokens.font.code,
  }

  const actionsCellStyle: React.CSSProperties = {
    ...cellStyle,
    display: 'flex',
    gap: tokens.space[2],
    alignItems: 'center',
    justifyContent: 'flex-end',
  }

  const priorityCellStyle: React.CSSProperties = {
    ...cellStyle,
    position: 'relative',
  }

  // Render priority dot with optional popover
  const renderPriorityCell = () => (
    <td style={priorityCellStyle}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setPopoverOpen((v) => !v)
        }}
        disabled={!onUpdatePriority}
        title={`P${task.priority}`}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: priorityDotColor(task.priority),
          border: 'none',
          cursor: onUpdatePriority ? 'pointer' : 'default',
          padding: 0,
        }}
        aria-label={`Priority ${task.priority}`}
      />
      {popoverOpen && onUpdatePriority && (
        <PriorityPopover task={task} onUpdate={onUpdatePriority} onClose={() => setPopoverOpen(false)} />
      )}
    </td>
  )

  // Render title cell
  const renderTitleCell = () => (
    <td style={titleCellStyle}>
      <button
        onClick={handleRowClick}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          fontSize: 'inherit',
          fontFamily: 'inherit',
          fontWeight: 'inherit',
          cursor: 'inherit',
          padding: 0,
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
        }}
      >
        {variant === 'blocked' && (
          <Badge variant="warning" size="sm">
            BLOCKED
          </Badge>
        )}
        {task.title}
      </button>
    </td>
  )

  // Render repo badge cell
  const renderRepoCell = () => (
    <td style={cellStyle}>
      <Badge variant={repoBadgeVariant(task.repo)} size="sm">
        {task.repo}
      </Badge>
    </td>
  )

  // Render date cell
  const renderDateCell = () => {
    let dateText = '—'
    if (variant === 'done' && task.completed_at) {
      dateText = formatDate(task.completed_at)
    } else if (variant === 'failed' && task.updated_at) {
      dateText = formatDate(task.updated_at)
    } else if ((variant === 'backlog' || variant === 'blocked') && task.created_at) {
      dateText = timeAgo(task.created_at)
    }
    return <td style={dateCellStyle}>{dateText}</td>
  }

  // Render PR link cell
  const renderPRCell = () => (
    <td style={cellStyle}>
      {task.pr_url ? (
        <a
          href={task.pr_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: tokens.color.accent,
            textDecoration: 'none',
            fontSize: tokens.size.xs,
            display: 'inline-flex',
            alignItems: 'center',
            gap: tokens.space[1],
          }}
        >
          #{task.pr_number} <ExternalLink size={10} />
        </a>
      ) : (
        <span style={{ color: tokens.color.textMuted }}>—</span>
      )}
    </td>
  )

  // Render action buttons
  const renderActionsCell = () => {
    const buttonStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: tokens.space[1],
      padding: `${tokens.space[1]} ${tokens.space[2]}`,
      fontSize: tokens.size.xs,
      fontFamily: tokens.font.ui,
      fontWeight: 500,
      border: 'none',
      borderRadius: tokens.radius.sm,
      background: 'transparent',
      color: tokens.color.textMuted,
      cursor: 'pointer',
      transition: tokens.transition.fast,
    }

    const iconButtonStyle: React.CSSProperties = {
      ...buttonStyle,
      padding: tokens.space[1],
    }

    return (
      <td style={actionsCellStyle}>
        {/* View Output button */}
        {onViewOutput && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onViewOutput(task)
            }}
            title="View Output"
            style={iconButtonStyle}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <Eye size={13} />
          </button>
        )}

        {/* Re-run button (for done tasks without PR or failed tasks) */}
        {onRerun && !task.pr_url && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRerun(task)
            }}
            title="Re-run"
            style={iconButtonStyle}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <RefreshCw size={13} />
          </button>
        )}

        {/* Mark Done button (for backlog/blocked tasks) */}
        {onMarkDone && (variant === 'backlog' || variant === 'blocked') && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMarkDone(task)
            }}
            title="Mark Done"
            style={iconButtonStyle}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.success
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <CheckCircle2 size={13} />
          </button>
        )}

        {/* Edit in Workbench button */}
        {onEditInWorkbench && (variant === 'backlog' || variant === 'blocked') && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEditInWorkbench(task)
            }}
            title="Edit in Workbench"
            style={buttonStyle}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            Edit
          </button>
        )}

        {/* Push to Sprint / Retry button */}
        {onPushToSprint && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPushToSprint(task)
            }}
            title={variant === 'failed' ? 'Retry — move back to sprint' : 'Move to sprint'}
            style={{
              ...buttonStyle,
              color: tokens.color.accent,
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <ArrowRight size={13} /> {variant === 'failed' ? 'Retry' : 'Sprint'}
          </button>
        )}
      </td>
    )
  }

  // Render row based on variant
  return (
    <tr
      style={rowStyle}
      data-selected={selected}
      data-dimmed={dimmed}
      aria-selected={selected}
      role="row"
    >
      {/* Backlog variant: Title | Pri | Repo | Created | Actions */}
      {variant === 'backlog' && (
        <>
          {renderTitleCell()}
          {renderPriorityCell()}
          {renderRepoCell()}
          {renderDateCell()}
          {renderActionsCell()}
        </>
      )}

      {/* Blocked variant: Title | Pri | Repo | Created | Actions */}
      {variant === 'blocked' && (
        <>
          {renderTitleCell()}
          {renderPriorityCell()}
          {renderRepoCell()}
          {renderDateCell()}
          {renderActionsCell()}
        </>
      )}

      {/* Done variant: Title | Repo | Completed | PR | Actions */}
      {variant === 'done' && (
        <>
          {renderTitleCell()}
          {renderRepoCell()}
          {renderDateCell()}
          {renderPRCell()}
          {renderActionsCell()}
        </>
      )}

      {/* Failed variant: Title | Repo | Cancelled | PR | Actions */}
      {variant === 'failed' && (
        <>
          {renderTitleCell()}
          {renderRepoCell()}
          {renderDateCell()}
          {renderPRCell()}
          {renderActionsCell()}
        </>
      )}
    </tr>
  )
}

export default SprintTaskRow
