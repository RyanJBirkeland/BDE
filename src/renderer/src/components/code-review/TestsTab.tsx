/**
 * TestsTab — surfaces the final `npm test` (or equivalent) output from the
 * agent conversation so reviewers don't have to scroll through every event.
 */
import { useEffect, useMemo } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { extractTestRuns } from '../../lib/extract-test-runs'
import { EmptyState } from '../ui/EmptyState'

export function TestsTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const agentRunId = task?.agent_run_id ?? null
  const agentEvents = useAgentEventsStore((s) =>
    agentRunId ? (s.events[agentRunId] ?? null) : null
  )

  useEffect(() => {
    if (agentRunId) loadHistory(agentRunId)
  }, [agentRunId, loadHistory])

  const runs = useMemo(() => extractTestRuns(agentEvents ?? []), [agentEvents])

  if (!task) return <div className="cr-placeholder">No task selected</div>

  if (!agentRunId) {
    return (
      <EmptyState
        title="No agent run"
        description="This task does not have a linked agent run to inspect for test output."
      />
    )
  }

  if (!agentEvents) {
    return (
      <div
        className="cr-tests"
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}
      >
        <div className="bde-skeleton" style={{ height: 28 }} />
        <div className="bde-skeleton" style={{ height: 140 }} />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No test runs found"
        description="No test runs found in this agent session."
      />
    )
  }

  const last = runs[runs.length - 1]

  return (
    <div className="cr-tests" data-testid="cr-tests-tab" style={{ padding: 12 }}>
      <div
        className="cr-tests__header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8
        }}
      >
        <div
          style={{
            fontFamily: 'var(--bde-font-mono, monospace)',
            fontSize: 12,
            color: 'var(--bde-text, rgba(255,255,255,0.85))'
          }}
          data-testid="cr-tests-command"
        >
          $ {last.command}
        </div>
        <div
          data-testid="cr-tests-status"
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            color: last.success ? 'var(--neon-cyan)' : 'var(--neon-red, #ff5c5c)',
            border: `1px solid ${last.success ? 'var(--neon-cyan-border, rgba(0,255,255,0.4))' : 'var(--neon-red-border, rgba(255,70,70,0.4))'}`,
            textTransform: 'uppercase',
            fontWeight: 600
          }}
        >
          {last.success ? 'Passed' : 'Failed'}
        </div>
      </div>
      {runs.length > 1 && (
        <div
          style={{
            fontSize: 10,
            opacity: 0.6,
            marginBottom: 8
          }}
        >
          Showing latest of {runs.length} test runs in this session.
        </div>
      )}
      <pre
        className="cr-tests__output"
        data-testid="cr-tests-output"
        style={{
          margin: 0,
          padding: 12,
          background: 'var(--bde-surface-raised, rgba(0,0,0,0.3))',
          border: '1px solid var(--bde-border, rgba(255,255,255,0.08))',
          borderRadius: 6,
          fontSize: 12,
          fontFamily: 'var(--bde-font-mono, monospace)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 600,
          overflow: 'auto',
          color: 'var(--bde-text, rgba(255,255,255,0.85))'
        }}
      >
        {last.output || '(no output captured)'}
      </pre>
    </div>
  )
}
