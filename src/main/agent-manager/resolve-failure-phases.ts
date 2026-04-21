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

export interface ResolveFailureContext {
  taskId: string
  retryCount: number
  notes?: string | undefined
  repo: IAgentTaskRepository
}

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
 * Returns true if the task is in a terminal failed state, false if requeued for retry.
 */
export function resolveFailure(opts: ResolveFailureContext, logger?: Logger): boolean {
  const { taskId, retryCount, repo } = opts
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
      repo.updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null,
        next_eligible_at: nextEligibleAt,
        failure_reason: failureReason,
        ...(notes ? { notes } : {})
      })
      return false // not terminal
    } else {
      repo.updateTask(taskId, {
        status: 'failed',
        completed_at: nowIso(),
        claimed_by: null,
        needs_review: true,
        failure_reason: failureReason,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
        ...(notes ? { notes } : {})
      })
      return true // terminal
    }
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    // Still return correct terminal status even if DB update failed
    // so caller knows to trigger onStatusTerminal callback
    return isTerminal
  }
}
