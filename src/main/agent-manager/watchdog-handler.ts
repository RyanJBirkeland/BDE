/**
 * Watchdog verdict handling — maps agent health check failures to task
 * status updates and concurrency adjustments.
 *
 * Extracted from index.ts to isolate verdict handling logic and reduce
 * file size.
 */

import { applyBackpressure, type ConcurrencyState } from './concurrency'
import type { Logger } from '../logger'
import type { WatchdogAction } from './types'

/**
 * Handle a watchdog verdict by updating the task and optionally applying backpressure.
 * Returns the (possibly updated) concurrency state.
 */
export function handleWatchdogVerdict(
  verdict: WatchdogAction,
  taskId: string,
  concurrency: ConcurrencyState,
  now: string,
  updateTaskFn: (id: string, patch: Record<string, unknown>) => unknown,
  onTerminal: (id: string, status: string) => Promise<void>,
  logger: Logger,
  maxRuntimeMs?: number
): ConcurrencyState {
  if (verdict === 'max-runtime') {
    const runtimeMinutes = maxRuntimeMs ? Math.round(maxRuntimeMs / 60000) : 60
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes: `Agent exceeded the maximum runtime of ${runtimeMinutes} minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.`,
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(
          `[watchdog-handler] Failed onTerminal for task ${taskId} after max-runtime kill: ${err}`
        )
      )
    } catch (err) {
      logger.warn(
        `[watchdog-handler] Failed to update task ${taskId} after max-runtime kill: ${err}`
      )
    }
  } else if (verdict === 'idle') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes:
          "Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to 'queued'.",
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(
          `[watchdog-handler] Failed onTerminal for task ${taskId} after idle kill: ${err}`
        )
      )
    } catch (err) {
      logger.warn(`[watchdog-handler] Failed to update task ${taskId} after idle kill: ${err}`)
    }
  } else if (verdict === 'rate-limit-loop') {
    concurrency = applyBackpressure(concurrency, Date.now())
    try {
      updateTaskFn(taskId, {
        status: 'queued',
        claimed_by: null,
        notes:
          'Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown.'
      })
    } catch (err) {
      logger.warn(`[watchdog-handler] Failed to requeue rate-limited task ${taskId}: ${err}`)
    }
  } else if (verdict === 'cost-budget-exceeded') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes:
          'Agent exceeded the cost budget (max_cost_usd). The task consumed more API credits than allowed. Review the task complexity or increase the budget.',
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(
          `[watchdog-handler] Failed onTerminal for task ${taskId} after cost budget exceeded: ${err}`
        )
      )
    } catch (err) {
      logger.warn(
        `[watchdog-handler] Failed to update task ${taskId} after cost budget exceeded: ${err}`
      )
    }
  }
  return concurrency
}
