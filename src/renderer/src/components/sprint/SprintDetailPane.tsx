/**
 * SprintDetailPane — context-aware right pane for Sprint Center redesign.
 * Shows comprehensive task details, agent info, PR status, and actions.
 */
import { useState, useMemo, useCallback } from 'react'
import {
  Clock,
  GitBranch,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  StopCircle,
  RefreshCw,
  Edit3,
  Trash2,
  FileText,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SpecViewer } from './SpecViewer'
import { SpecEditor } from './SpecEditor'
import { tokens } from '../../design-system/tokens'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintEvents } from '../../stores/sprintEvents'
import { TASK_STATUS } from '../../../../shared/constants'
import { toast } from '../../stores/toasts'
import type { SprintTask } from '../../../../shared/types'

interface SprintDetailPaneProps {
  task: SprintTask | null
  onClose: () => void
  onLaunch?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
  onRerun?: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onDelete?: (taskId: string) => void
  onSaveSpec?: (taskId: string, spec: string) => void
  onEditInWorkbench?: (task: SprintTask) => void
}

function statusBadgeVariant(status: string): 'default' | 'success' | 'danger' | 'warning' | 'info' {
  switch (status) {
    case TASK_STATUS.ACTIVE:
      return 'success'
    case TASK_STATUS.DONE:
      return 'info'
    case TASK_STATUS.FAILED:
    case TASK_STATUS.ERROR:
      return 'danger'
    case TASK_STATUS.BLOCKED:
      return 'warning'
    case TASK_STATUS.QUEUED:
      return 'info'
    default:
      return 'default'
  }
}

export function SprintDetailPane({
  task,
  onClose,
  onLaunch,
  onStop,
  onRerun,
  onMarkDone,
  onDelete,
  onSaveSpec,
  onEditInWorkbench,
}: SprintDetailPaneProps) {
  const [editingSpec, setEditingSpec] = useState(false)
  const [specDraft, setSpecDraft] = useState('')
  const [specExpanded, setSpecExpanded] = useState(true)
  const [metadataExpanded, setMetadataExpanded] = useState(true)
  const [agentExpanded, setAgentExpanded] = useState(true)

  const allTasks = useSprintTasks((s) => s.tasks)
  const latestEvent = useSprintEvents((s) => (task ? s.latestEvents[task.id] : null))

  // Get dependency tasks
  const dependencyTasks = useMemo(() => {
    if (!task?.depends_on) return []
    return task.depends_on
      .map((dep) => allTasks.find((t) => t.id === dep.id))
      .filter((t): t is SprintTask => t !== undefined)
  }, [task?.depends_on, allTasks])

  const handleSaveSpec = useCallback(() => {
    if (!task || !onSaveSpec) return
    onSaveSpec(task.id, specDraft)
    setEditingSpec(false)
    toast.success('Spec saved')
  }, [task, specDraft, onSaveSpec])

  const handleStartEditSpec = useCallback(() => {
    if (!task) return
    setSpecDraft(task.spec || task.prompt || '')
    setEditingSpec(true)
  }, [task])

  const handleDelete = useCallback(() => {
    if (!task || !onDelete) return
    if (confirm(`Delete task "${task.title}"?`)) {
      onDelete(task.id)
      onClose()
      toast.success('Task deleted')
    }
  }, [task, onDelete, onClose])

  if (!task) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: tokens.color.surface,
          color: tokens.color.textMuted,
          fontSize: tokens.size.md,
          fontFamily: tokens.font.ui,
        }}
      >
        Select a task to view details
      </div>
    )
  }

  const isActive = task.status === TASK_STATUS.ACTIVE
  const isDone = task.status === TASK_STATUS.DONE
  const isFailed = task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.ERROR
  const isQueued = task.status === TASK_STATUS.QUEUED
  const isBlocked = task.status === TASK_STATUS.BLOCKED
  const hasAgent = !!task.agent_run_id
  const hasPR = !!task.pr_url
  const hasSpec = !!task.spec

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.color.surface,
        borderLeft: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.ui,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[2],
          padding: `${tokens.space[3]} ${tokens.space[4]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
          <FileText size={16} color={tokens.color.textMuted} />
          <span
            style={{
              fontSize: tokens.size.lg,
              fontWeight: 600,
              color: tokens.color.text,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={task.title}
          >
            {task.title}
          </span>
          <Badge variant={statusBadgeVariant(task.status)} size="sm">
            {task.status}
          </Badge>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close detail pane">
            ✕
          </Button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: tokens.space[2], flexWrap: 'wrap' }}>
          {isQueued && onLaunch && (
            <Button variant="primary" size="sm" onClick={() => onLaunch(task)}>
              <PlayCircle size={14} /> Launch
            </Button>
          )}
          {isActive && onStop && (
            <Button variant="danger" size="sm" onClick={() => onStop(task)}>
              <StopCircle size={14} /> Stop
            </Button>
          )}
          {(isFailed || (isDone && !hasPR)) && onRerun && (
            <Button variant="ghost" size="sm" onClick={() => onRerun(task)}>
              <RefreshCw size={14} /> Re-run
            </Button>
          )}
          {(isQueued || isActive) && onMarkDone && (
            <Button variant="ghost" size="sm" onClick={() => onMarkDone(task)}>
              <CheckCircle2 size={14} /> Mark Done
            </Button>
          )}
          {onEditInWorkbench && (
            <Button variant="ghost" size="sm" onClick={() => onEditInWorkbench(task)}>
              <Edit3 size={14} /> Edit
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* Metadata Section */}
        <Section
          title="Metadata"
          expanded={metadataExpanded}
          onToggle={() => setMetadataExpanded(!metadataExpanded)}
        >
          <MetadataRow icon={GitBranch} label="Repository" value={task.repo} />
          <MetadataRow label="Priority" value={`P${task.priority}`} />
          {task.created_at && (
            <MetadataRow
              icon={Clock}
              label="Created"
              value={new Date(task.created_at).toLocaleString()}
            />
          )}
          {task.started_at && (
            <MetadataRow
              icon={Clock}
              label="Started"
              value={new Date(task.started_at).toLocaleString()}
            />
          )}
          {task.completed_at && (
            <MetadataRow
              icon={Clock}
              label="Completed"
              value={new Date(task.completed_at).toLocaleString()}
            />
          )}
          {task.retry_count > 0 && (
            <MetadataRow label="Retries" value={task.retry_count.toString()} />
          )}
        </Section>

        {/* Dependencies Section */}
        {dependencyTasks.length > 0 && (
          <Section title="Dependencies" expanded defaultExpanded>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
              {dependencyTasks.map((dep) => (
                <div
                  key={dep.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                    padding: tokens.space[2],
                    background: tokens.color.surfaceHigh,
                    borderRadius: tokens.radius.sm,
                    fontSize: tokens.size.sm,
                  }}
                >
                  <span
                    style={{
                      color:
                        dep.status === 'done'
                          ? tokens.color.success
                          : tokens.color.textMuted,
                    }}
                  >
                    {dep.status === 'done' ? '✓' : '○'}
                  </span>
                  <span style={{ flex: 1, color: tokens.color.text }}>{dep.title}</span>
                  <Badge variant={statusBadgeVariant(dep.status)} size="sm">
                    {dep.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Blocked Status Alert */}
        {isBlocked && (
          <div
            style={{
              margin: tokens.space[3],
              padding: tokens.space[3],
              background: tokens.color.warningDim,
              border: `1px solid ${tokens.color.warning}`,
              borderRadius: tokens.radius.md,
              display: 'flex',
              alignItems: 'flex-start',
              gap: tokens.space[2],
            }}
          >
            <AlertCircle size={16} color={tokens.color.warning} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: tokens.size.sm, color: tokens.color.text }}>
              <strong>Task is blocked</strong>
              <br />
              {dependencyTasks.length > 0
                ? `Waiting for ${dependencyTasks.filter((d) => d.status !== 'done').length} dependencies to complete.`
                : 'This task has dependencies that must be resolved first.'}
            </div>
          </div>
        )}

        {/* Spec Section */}
        {(hasSpec || task.prompt) && (
          <Section
            title="Specification"
            expanded={specExpanded}
            onToggle={() => setSpecExpanded(!specExpanded)}
          >
            {editingSpec ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
                <SpecEditor value={specDraft} onChange={setSpecDraft} />
                <div style={{ display: 'flex', gap: tokens.space[2] }}>
                  <Button variant="primary" size="sm" onClick={handleSaveSpec}>
                    Save Spec
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingSpec(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
                <SpecViewer content={task.spec || task.prompt || ''} onEdit={handleStartEditSpec} />
                {onSaveSpec && (
                  <Button variant="ghost" size="sm" onClick={handleStartEditSpec}>
                    <Edit3 size={14} /> Edit Spec
                  </Button>
                )}
              </div>
            )}
          </Section>
        )}

        {/* Agent Section */}
        {hasAgent && (
          <Section
            title="Agent Run"
            expanded={agentExpanded}
            onToggle={() => setAgentExpanded(!agentExpanded)}
          >
            <MetadataRow label="Agent ID" value={task.agent_run_id?.slice(0, 16) || 'N/A'} mono />
            {latestEvent && (
              <div
                style={{
                  padding: tokens.space[2],
                  background: tokens.color.surfaceHigh,
                  borderRadius: tokens.radius.sm,
                  fontSize: tokens.size.sm,
                  color: tokens.color.textMuted,
                  fontFamily: tokens.font.code,
                }}
              >
                {latestEvent.type === 'agent:thinking' && 'text' in latestEvent && latestEvent.text}
                {latestEvent.type === 'agent:tool_call' && 'tool' in latestEvent && `Tool: ${latestEvent.tool}`}
                {latestEvent.type === 'agent:text' && 'text' in latestEvent && latestEvent.text}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('bde:navigate', {
                    detail: { view: 'agents', sessionId: task.agent_run_id },
                  })
                )
              }}
            >
              <ExternalLink size={14} /> Open in Agents View
            </Button>
          </Section>
        )}

        {/* PR Section */}
        {hasPR && (
          <Section title="Pull Request" expanded defaultExpanded>
            <MetadataRow label="PR Number" value={`#${task.pr_number}`} />
            <MetadataRow
              label="Status"
              value={task.pr_status || 'unknown'}
              badge={
                task.pr_status === 'merged' ? (
                  <Badge variant="success" size="sm">
                    Merged
                  </Badge>
                ) : task.pr_status === 'open' ? (
                  <Badge variant="info" size="sm">
                    Open
                  </Badge>
                ) : task.pr_status === 'closed' ? (
                  <Badge variant="default" size="sm">
                    Closed
                  </Badge>
                ) : null
              }
            />
            {task.pr_mergeable_state && (
              <MetadataRow
                label="Mergeable"
                value={task.pr_mergeable_state}
                badge={
                  task.pr_mergeable_state === 'dirty' ? (
                    <Badge variant="danger" size="sm">
                      Conflict
                    </Badge>
                  ) : task.pr_mergeable_state === 'clean' ? (
                    <Badge variant="success" size="sm">
                      Clean
                    </Badge>
                  ) : null
                }
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => task.pr_url && window.api.openExternal(task.pr_url)}
            >
              <ExternalLink size={14} /> View PR
            </Button>
          </Section>
        )}

        {/* Notes Section */}
        {task.notes && (
          <Section title="Notes" expanded defaultExpanded>
            <div
              style={{
                padding: tokens.space[3],
                background: tokens.color.surfaceHigh,
                borderRadius: tokens.radius.sm,
                fontSize: tokens.size.sm,
                color: tokens.color.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {task.notes}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

// ─── Helper Components ───────────────────────────────────────────────────────

interface SectionProps {
  title: string
  expanded: boolean
  defaultExpanded?: boolean
  onToggle?: () => void
  children: React.ReactNode
}

function Section({ title, expanded, onToggle, children }: SectionProps) {
  return (
    <div
      style={{
        borderBottom: `1px solid ${tokens.color.border}`,
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${tokens.space[2]} ${tokens.space[4]}`,
          background: tokens.color.surfaceHigh,
          border: 'none',
          cursor: 'pointer',
          fontSize: tokens.size.sm,
          fontWeight: 600,
          color: tokens.color.text,
          fontFamily: tokens.font.ui,
        }}
      >
        <span>{title}</span>
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: tokens.transition.fast }}>
          ›
        </span>
      </button>
      {expanded && (
        <div style={{ padding: `${tokens.space[3]} ${tokens.space[4]}` }}>
          {children}
        </div>
      )}
    </div>
  )
}

interface MetadataRowProps {
  icon?: React.ComponentType<{ size: number; color?: string }>
  label: string
  value: string
  mono?: boolean
  badge?: React.ReactNode
}

function MetadataRow({ icon: Icon, label, value, mono, badge }: MetadataRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[1]} 0`,
        fontSize: tokens.size.sm,
      }}
    >
      {Icon && <Icon size={14} color={tokens.color.textMuted} />}
      <span style={{ color: tokens.color.textMuted, minWidth: '100px' }}>{label}:</span>
      <span
        style={{
          color: tokens.color.text,
          fontFamily: mono ? tokens.font.code : tokens.font.ui,
          flex: 1,
        }}
      >
        {value}
      </span>
      {badge}
    </div>
  )
}
