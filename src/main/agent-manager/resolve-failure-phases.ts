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
  notes?: string
  repo: IAgentTaskRepository
}

/**
 * Calculates exponential backoff delay for agent retries.
 * Returns delay in milliseconds, capped at RETRY_BACKOFF_CAP_MS.
 */
export function calculateRetryBackoff(retryCount: number): number {
  return Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount))
}

/**
 * Resolve a task failure: requeue with backoff (non-terminal) or mark failed (terminal).
 * Returns true if the task is in a terminal failed state, false if requeued for retry.
 */
export function resolveFailure(opts: ResolveFailureContext, logger?: Logger): boolean {
  const { taskId, retryCount, notes, repo } = opts

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
