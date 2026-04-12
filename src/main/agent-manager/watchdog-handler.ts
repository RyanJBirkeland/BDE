/**
 * Watchdog verdict handling — maps agent health check failures to
 * decision objects that the caller applies.
 *
 * Pure function: no side effects. The caller (AgentManager._watchdogLoop)
 * owns task updates, terminal notifications, and concurrency changes.
 */

import { applyBackpressure, type ConcurrencyState } from './concurrency'
import type { WatchdogAction } from './types'

export interface WatchdogVerdictResult {
  taskUpdate: Record<string, unknown> | null
  shouldNotifyTerminal: boolean
  terminalStatus?: string
  shouldRequeue?: boolean
  concurrency: ConcurrencyState
}

/**
 * Map a watchdog verdict to a decision object describing what the caller
 * should do. Does not execute any side effects itself.
 */
export function handleWatchdogVerdict(
  verdict: WatchdogAction,
  concurrency: ConcurrencyState,
  now: string,
  maxRuntimeMs?: number
): WatchdogVerdictResult {
  if (verdict === 'max-runtime') {
    const runtimeMinutes = maxRuntimeMs ? Math.round(maxRuntimeMs / 60000) : 60
    return {
      taskUpdate: {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes: `Agent exceeded the maximum runtime of ${runtimeMinutes} minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.`,
        needs_review: true
      },
      shouldNotifyTerminal: true,
      terminalStatus: 'error',
      concurrency
    }
  }

  if (verdict === 'idle') {
    return {
      taskUpdate: {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes:
          "Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to 'queued'.",
        needs_review: true
      },
      shouldNotifyTerminal: true,
      terminalStatus: 'error',
      concurrency
    }
  }

  if (verdict === 'rate-limit-loop') {
    return {
      taskUpdate: {
        status: 'queued',
        claimed_by: null,
        notes:
          'Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown.'
      },
      shouldNotifyTerminal: false,
      shouldRequeue: true,
      concurrency: applyBackpressure(concurrency, Date.now())
    }
  }

  if (verdict === 'cost-budget-exceeded') {
    return {
      taskUpdate: {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes:
          'Agent exceeded the cost budget (max_cost_usd). The task consumed more API credits than allowed. Review the task complexity or increase the budget.',
        needs_review: true
      },
      shouldNotifyTerminal: true,
      terminalStatus: 'error',
      concurrency
    }
  }

  // Unknown verdict — no-op
  return { taskUpdate: null, shouldNotifyTerminal: false, concurrency }
}
