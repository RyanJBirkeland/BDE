/**
 * Failure-path phase functions for agent task completion.
 *
 * resolveFailure() decides whether to requeue (with backoff) or mark the task
 * as permanently failed, based on retry count.
 *
 * calculateRetryBackoff() is extracted as a pure function for testability.
 */
import { MAX_RETRIES, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS } from './types'
import type { Logger } from '../logger'
import { nowIso } from '../../shared/time'
import { classifyFailureReason } from './failure-classifier'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { TaskStateService } from '../services/task-state-service'

export interface ResolveFailureContext {
  taskId: string
  retryCount: number
  notes?: string | undefined
  repo: IAgentTaskRepository
  taskStateService?: TaskStateService
}

/**
 * Tagged result returned by `resolveFailure`.
 *
 * When the DB write succeeds, `writeFailed` is absent (or `false`).
 * When the DB write fails after all retries, `writeFailed` is `true` and
 * `error` holds the thrown error — callers must skip `onTaskTerminal` in this
 * case to prevent unblocking dependents against a task still in `active` in DB.
 */
export type ResolveFailureResult =
  | { isTerminal: boolean; writeFailed?: false }
  | { isTerminal: boolean; writeFailed: true; error: Error }

/**
 * Calculates exponential backoff delay for agent retries.
 * Returns delay in milliseconds, capped at RETRY_BACKOFF_CAP_MS.
 */
export function calculateRetryBackoff(retryCount: number): number {
  const base = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount))
  // ±20% jitter to prevent thundering-herd when multiple agents fail simultaneously
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

// Keep the last N chars of failure notes — root causes are at the tail (end of stack traces).
const NOTES_TAIL_CHARS = 1500

/**
 * Truncates failure notes to the last NOTES_TAIL_CHARS characters so the retry agent sees
 * the actual error (which is always at the tail of a stack trace) rather than preamble.
 */
function truncateNotesTail(notes: string | undefined): string | undefined {
  if (!notes) return undefined
  return notes.length > NOTES_TAIL_CHARS ? '...' + notes.slice(-NOTES_TAIL_CHARS) : notes
}

/**
 * Resolve a task failure: requeue with backoff (non-terminal) or mark failed (terminal).
 * Returns a tagged result indicating whether the task is terminal and whether the DB write
 * succeeded. Callers must check `writeFailed` before calling `onTaskTerminal` — firing
 * dependency resolution against a task still `active` in SQLite would corrupt the graph.
 *
 * When `opts.taskStateService` is supplied, all status writes go through
 * `TaskStateService.transition()` so the audit trail and terminal dispatch fire uniformly.
 * When absent (legacy callers or tests), the function falls back to `repo.updateTask` and
 * the caller is responsible for invoking `onTaskTerminal` on the terminal branch.
 */
export async function resolveFailure(
  opts: ResolveFailureContext,
  logger?: Logger
): Promise<ResolveFailureResult> {
  const { taskId, retryCount, repo, taskStateService } = opts
  // Tail-truncate before writing to DB so stack trace root causes are preserved.
  const notes = truncateNotesTail(opts.notes)

  // Classify failure reason for structured filtering
  const failureReason = classifyFailureReason(notes)

  // Determine if this is a terminal state (exhausted retries)
  const isTerminal = retryCount >= MAX_RETRIES

  // Calculate duration from started_at to now (for terminal failures only)
  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (isTerminal && task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  try {
    if (!isTerminal) {
      // Exponential backoff: 30s, 60s, 120s, capped at 5 minutes
      const backoffMs = calculateRetryBackoff(retryCount)
      const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString()
      const requeueFields = {
        retry_count: retryCount + 1,
        claimed_by: null,
        next_eligible_at: nextEligibleAt,
        failure_reason: failureReason,
        ...(notes ? { notes } : {})
      }
      if (taskStateService) {
        await taskStateService.transition(taskId, 'queued', {
          fields: requeueFields,
          caller: 'resolve-failure:requeue'
        })
      } else {
        await repo.updateTask(taskId, { status: 'queued', ...requeueFields })
      }
      return { isTerminal: false }
    } else {
      const failFields = {
        completed_at: nowIso(),
        claimed_by: null,
        needs_review: true,
        failure_reason: failureReason,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
        ...(notes ? { notes } : {})
      }
      if (taskStateService) {
        await taskStateService.transition(taskId, 'failed', {
          fields: failFields,
          caller: 'resolve-failure:terminal'
        })
      } else {
        await repo.updateTask(taskId, { status: 'failed', ...failFields }) // phase-a-bypass
      }
      return { isTerminal: true }
    }
  } catch (err) {
    const writeError = err instanceof Error ? err : new Error(String(err))
    logger?.event?.('failure.persist_failed', { taskId, error: String(err) })
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    // Return a tagged failure instead of rethrowing. The DB row was not updated,
    // so callers must NOT invoke onTaskTerminal — that would unblock dependents
    // against a task still `active` in SQLite.
    return { isTerminal, writeFailed: true, error: writeError }
  }
}
