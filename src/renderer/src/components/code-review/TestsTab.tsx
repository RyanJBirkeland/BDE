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
import './TestsTab.css'

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
      <div className="cr-tests cr-tests__loading">
        <div className="bde-skeleton" />
        <div className="bde-skeleton" />
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
  if (!last) {
    return (
      <EmptyState
        title="No test runs found"
        description="No test runs found in this agent session."
      />
    )
  }
  const statusClass = last.success
    ? 'cr-tests__status'
    : 'cr-tests__status cr-tests__status--failed'

  return (
    <div className="cr-tests" data-testid="cr-tests-tab">
      <div className="cr-tests__header">
        <div className="cr-tests__command" data-testid="cr-tests-command">
          $ {last.command}
        </div>
        <div data-testid="cr-tests-status" className={statusClass}>
          {last.success ? 'Passed' : 'Failed'}
        </div>
      </div>
      {runs.length > 1 && (
        <div className="cr-tests__hint">
          Showing latest of {runs.length} test runs in this session.
        </div>
      )}
      <pre className="cr-tests__output" data-testid="cr-tests-output">
        {last.output || '(no output captured)'}
      </pre>
    </div>
  )
}
