import React from 'react'
import type { SprintTask } from '../../../../shared/types'
import type { AgentEvent } from '../../../../shared/types'
import { parseRevisionFeedback } from '../../../../shared/types/revision'
import type { RevisionFeedback } from '../../../../shared/types/revision'
import { failureCategoryForReason } from '../../lib/task-format'
import { DrawerSection } from './primitives/DrawerSection'

interface TaskDrawerFailureDiagnosticsProps {
  task: SprintTask
  recentAgentErrors: AgentEvent[]
}

export function TaskDrawerFailureDiagnostics({
  task,
  recentAgentErrors
}: TaskDrawerFailureDiagnosticsProps): React.JSX.Element | null {
  const isFailureStatus =
    task.status === 'failed' || task.status === 'error' || task.status === 'cancelled'
  if (!isFailureStatus) return null

  const sectionTitle = task.status === 'cancelled' ? 'Cancellation' : 'Failure'

  return (
    <DrawerSection eyebrow="FAIL" title={sectionTitle}>
      <FailureBox task={task} recentAgentErrors={recentAgentErrors} />
    </DrawerSection>
  )
}

// --- Private sub-components ---

interface FailureBoxProps {
  task: SprintTask
  recentAgentErrors: AgentEvent[]
}

function FailureBox({ task, recentAgentErrors }: FailureBoxProps): React.JSX.Element {
  return (
    <div
      data-testid="task-drawer-failure"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
        padding: 'var(--s-3)',
        borderRadius: 'var(--r-md)',
        border: '1px solid color-mix(in oklch, var(--st-failed) 25%, transparent)',
        background: 'color-mix(in oklch, var(--st-failed) 8%, var(--bg))'
      }}
    >
      {task.failure_reason && <FailureChip reason={task.failure_reason} />}
      {task.failure_reason && <FailureReasonText reason={task.failure_reason} />}
      {isWatchdogTimeout(task) && <WatchdogVerdict />}
      <FailureNotes notes={task.notes} />
      {recentAgentErrors.length > 0 && <RecentErrorsList errors={recentAgentErrors} />}
    </div>
  )
}

function isWatchdogTimeout(task: SprintTask): boolean {
  return (
    task.failure_reason === 'timeout' &&
    !!task.notes &&
    task.notes.toLowerCase().includes('watchdog')
  )
}

interface FailureChipProps {
  reason: string
}

function FailureChip({ reason }: FailureChipProps): React.JSX.Element {
  const category = failureCategoryForReason(reason)
  return (
    <span
      data-testid="task-drawer-failure-chip"
      style={{
        alignSelf: 'flex-start',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 'var(--r-sm)',
        background: 'color-mix(in oklch, var(--st-failed) 20%, transparent)',
        color: 'var(--st-failed)',
        border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)'
      }}
    >
      {category.label}
    </span>
  )
}

function FailureReasonText({ reason }: { reason: string }): React.JSX.Element {
  return (
    <pre
      data-testid="task-drawer-failure-reason"
      style={{
        margin: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-2)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}
    >
      {reason}
    </pre>
  )
}

function WatchdogVerdict(): React.JSX.Element {
  return (
    <div
      data-testid="task-drawer-watchdog-verdict"
      style={{ fontSize: 11, color: 'var(--fg-2)' }}
    >
      Watchdog terminated this agent. Increase the task&apos;s{' '}
      <strong>max runtime</strong> or split the work into smaller tasks.
    </div>
  )
}

function FailureNotes({ notes }: { notes: string | null | undefined }): React.JSX.Element {
  if (!notes) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
        No diagnostic notes captured. Check the Agents view for details.
      </span>
    )
  }
  const feedback = parseRevisionFeedback(notes)
  if (feedback) return <VerificationDiagnostics feedback={feedback} />
  return (
    <pre
      data-testid="task-drawer-failure-notes"
      style={{
        margin: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-2)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}
    >
      {notes}
    </pre>
  )
}

function VerificationDiagnostics({ feedback }: { feedback: RevisionFeedback }): React.JSX.Element {
  return (
    <div
      data-testid="task-drawer-verification-diagnostics"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}
    >
      <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>{feedback.summary}</p>
      {feedback.diagnostics.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: '0 0 0 var(--s-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-1)'
          }}
        >
          {feedback.diagnostics.map((d, i) => (
            <li key={i} style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                {d.file}
                {d.line !== undefined ? `:${d.line}` : ''} [{d.kind}]
              </span>{' '}
              {d.message}
              {d.suggestedFix && (
                <span style={{ color: 'var(--fg-3)' }}> — Fix: {d.suggestedFix}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentErrorsList({ errors }: { errors: AgentEvent[] }): React.JSX.Element {
  return (
    <div
      data-testid="task-drawer-failure-errors"
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
        Recent errors
      </span>
      {errors.map((e, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: 'var(--st-failed)',
            fontFamily: 'var(--font-mono)'
          }}
        >
          {e.type === 'agent:error' ? e.message : ''}
        </div>
      ))}
    </div>
  )
}
