/**
 * VerificationTab — surfaces the pre-review FLEET verification gate results
 * (typecheck + tests) alongside the agent's own test command output.
 *
 * Two sections:
 *  1. FLEET Verified — results from the verification gate stored in
 *     `task.verification_results`. Each check (typecheck, tests) shows its
 *     pass/fail status and a collapsible output block.
 *  2. Agent Test Runs — the agent's last `npm test` invocation from its
 *     conversation stream, extracted the same way as the old TestsTab.
 */
import { useEffect, useMemo } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { extractTestRuns } from '../../lib/extract-test-runs'
import type { VerificationRecord } from '../../../../shared/types/task-types'
import './TestsTab.css'

export function VerificationTab(): React.JSX.Element {
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

  const agentRuns = useMemo(() => extractTestRuns(agentEvents ?? []), [agentEvents])
  const lastAgentRun = agentRuns.length > 0 ? (agentRuns[agentRuns.length - 1] ?? null) : null
  const verificationResults = task?.verification_results ?? null

  if (!task) {
    return <div className="cr-placeholder">No task selected.</div>
  }

  return (
    <div className="cr-verification">
      <FleetVerifiedSection results={verificationResults} />
      <AgentTestRunsSection lastRun={lastAgentRun} totalRunCount={agentRuns.length} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// FLEET Verified section
// ---------------------------------------------------------------------------

interface FleetVerifiedSectionProps {
  results: { typecheck: VerificationRecord | null; tests: VerificationRecord | null } | null
}

function FleetVerifiedSection({ results }: FleetVerifiedSectionProps): React.JSX.Element {
  return (
    <section className="cr-verification__section">
      <h3 className="cr-verification__section-heading">FLEET Verified</h3>
      {results === null ? (
        <p className="cr-verification__empty">No FLEET verification record for this task.</p>
      ) : (
        <table className="cr-verification__table">
          <tbody>
            <VerificationRow label="Type check" record={results.typecheck} />
            <VerificationRow label="Tests" record={results.tests} />
          </tbody>
        </table>
      )}
    </section>
  )
}

interface VerificationRowProps {
  label: string
  record: VerificationRecord | null
}

function VerificationRow({ label, record }: VerificationRowProps): React.JSX.Element {
  if (record === null) {
    return (
      <tr className="cr-verification__row cr-verification__row--skipped">
        <td className="cr-verification__label">{label}</td>
        <td className="cr-verification__status">—</td>
        <td className="cr-verification__duration" />
      </tr>
    )
  }

  const passed = record.exitCode === 0
  const output = buildOutputText(record)

  return (
    <>
      <VerificationStatusRow label={label} passed={passed} durationMs={record.durationMs} />
      {output && <VerificationOutputRow output={output} truncated={record.truncated} />}
    </>
  )
}

interface VerificationStatusRowProps {
  label: string
  passed: boolean
  durationMs: number
}

function VerificationStatusRow({
  label,
  passed,
  durationMs
}: VerificationStatusRowProps): React.JSX.Element {
  const rowClass = passed
    ? 'cr-verification__row cr-verification__row--pass'
    : 'cr-verification__row cr-verification__row--fail'
  const durationSec = (durationMs / 1000).toFixed(1)
  const statusLabel = passed ? '✅ Passed' : '❌ Fail'

  return (
    <tr className={rowClass}>
      <td className="cr-verification__label">{label}</td>
      <td className="cr-verification__status">{statusLabel}</td>
      <td className="cr-verification__duration">{durationSec}s</td>
    </tr>
  )
}

interface VerificationOutputRowProps {
  output: string
  truncated: boolean
}

function VerificationOutputRow({ output, truncated }: VerificationOutputRowProps): React.JSX.Element {
  return (
    <tr className="cr-verification__output-row">
      <td colSpan={3}>
        <pre className="cr-verification__output">{output}</pre>
        {truncated && (
          <p className="cr-verification__truncated">output truncated at 10 000 chars</p>
        )}
      </td>
    </tr>
  )
}


function buildOutputText(record: VerificationRecord): string {
  return [record.stdout, record.stderr].filter((s) => s.length > 0).join('\n')
}

// ---------------------------------------------------------------------------
// Agent Test Runs section
// ---------------------------------------------------------------------------

interface AgentTestRunsSectionProps {
  lastRun: { command: string; output: string; success: boolean } | null
  totalRunCount: number
}

function AgentTestRunsSection({
  lastRun,
  totalRunCount
}: AgentTestRunsSectionProps): React.JSX.Element {
  return (
    <section className="cr-verification__section">
      <h3 className="cr-verification__section-heading">Agent Test Runs</h3>
      {lastRun === null ? (
        <p className="cr-verification__empty">No test commands detected in agent session.</p>
      ) : (
        <AgentTestRunDisplay run={lastRun} totalRunCount={totalRunCount} />
      )}
    </section>
  )
}

interface AgentTestRunDisplayProps {
  run: { command: string; output: string; success: boolean }
  totalRunCount: number
}

function AgentTestRunDisplay({ run, totalRunCount }: AgentTestRunDisplayProps): React.JSX.Element {
  const statusClass = run.success
    ? 'cr-tests__status'
    : 'cr-tests__status cr-tests__status--failed'

  return (
    <div className="cr-tests" data-testid="cr-agent-test-run">
      <div className="cr-tests__header">
        <div className="cr-tests__command">$ {run.command}</div>
        <div className={statusClass}>{run.success ? 'Passed' : 'Failed'}</div>
      </div>
      {totalRunCount > 1 && (
        <div className="cr-tests__hint">
          Showing latest of {totalRunCount} test runs in this session.
        </div>
      )}
      <pre className="cr-tests__output">{run.output || '(no output captured)'}</pre>
    </div>
  )
}
