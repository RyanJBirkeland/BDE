/**
 * Watchdog loop — agent health checks, idle/timeout/rate-limit verdicts.
 *
 * Extracted from AgentManagerImpl._watchdogLoop so the logic can be
 * unit-tested without spinning up a full manager instance.
 */

import type { Logger } from '../logger'
import type { AgentManagerConfig, ActiveAgent, WatchdogAction } from './types'
import type { MetricsCollector } from './metrics'
import type { ConcurrencyState } from './concurrency'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { checkAgent } from './watchdog'
import { handleWatchdogVerdict } from './watchdog-handler'
import { flushAgentEventBatcher } from '../agent-event-mapper'
import { nowIso } from '../../shared/time'

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface WatchdogLoopDeps {
  config: AgentManagerConfig
  repo: IAgentTaskRepository
  metrics: MetricsCollector
  logger: Logger
  activeAgents: Map<string, ActiveAgent>
  processingTasks: Set<string>
  /** Returns the live ConcurrencyState — called each time to avoid stale captures. */
  getConcurrency: () => ConcurrencyState
  setConcurrency: (state: ConcurrencyState) => void
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  /**
   * Optional hook to clean up the agent's git worktree after a watchdog kill.
   * Called only when the task is NOT in `review` status (review worktrees are
   * preserved for human inspection). Errors are caught and logged by the caller.
   */
  cleanupAgentWorktree?: (agent: ActiveAgent) => Promise<void>
}

// ---------------------------------------------------------------------------
// Kill helper
// ---------------------------------------------------------------------------

/**
 * Abort an active agent's OS handle and send SIGKILL to its subprocess if available.
 * Does NOT remove the agent from the active-agents map — callers are responsible for
 * map removal after the DB write succeeds (or after deciding to remove on DB failure).
 * SDK may not expose process — revisit when SDK exposes subprocess handle.
 */
export function abortAgent(agent: ActiveAgent, logger: Logger): void {
  try {
    agent.handle.abort()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (agent.handle as any).process
    if (proc && typeof proc.kill === 'function') {
      proc.kill('SIGKILL')
    }
  } catch (err) {
    logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
  }
}

/**
 * Remove an agent from the active-agents map if it is still current.
 * Guards against removing a newer retry that has overwritten the same task slot.
 */
export function removeAgentFromMap(
  agent: ActiveAgent,
  activeAgents: Map<string, ActiveAgent>
): void {
  // Guard: only remove if this run's entry is still current — a retry may have overwritten it
  if (activeAgents.get(agent.taskId)?.agentRunId === agent.agentRunId) {
    activeAgents.delete(agent.taskId)
  }
}

/**
 * Abort an active agent's handle and remove it from the active agents map.
 * Kept for backward compatibility with callers that need the combined operation.
 */
export function killActiveAgent(
  agent: ActiveAgent,
  activeAgents: Map<string, ActiveAgent>,
  logger: Logger
): void {
  abortAgent(agent, logger)
  removeAgentFromMap(agent, activeAgents)
}

// ---------------------------------------------------------------------------
// Main watchdog tick
// ---------------------------------------------------------------------------

/**
 * Execute one watchdog tick: check all active agents, collect the ones that
 * need killing, then process kills (abort handle + status update + terminal
 * notification). Agents currently being processed by the drain loop are
 * skipped to avoid double-transition races.
 */
export async function runWatchdog(deps: WatchdogLoopDeps): Promise<void> {
  const agentsToKill: Array<{ agent: ActiveAgent; verdict: WatchdogAction }> = []

  for (const agent of deps.activeAgents.values()) {
    if (deps.processingTasks.has(agent.taskId)) continue
    const verdict = checkAgent(agent, Date.now(), deps.config)
    if (verdict !== 'ok') {
      agentsToKill.push({ agent, verdict })
    }
  }

  for (const { agent, verdict } of agentsToKill) {
    deps.logger.warn(`[agent-manager] Watchdog killing task ${agent.taskId}: ${verdict}`)
    deps.metrics.recordWatchdogVerdict(verdict)
    if (verdict === 'rate-limit-loop') {
      deps.metrics.increment('retriesQueued')
    }

    // Step 1: Kill the OS process — does NOT yet remove from map.
    abortAgent(agent, deps.logger)
    cleanupWorktreeIfNotInReview(agent, deps)

    const now = nowIso()
    const maxRuntimeMs = agent.maxRuntimeMs ?? deps.config.maxRuntimeMs
    const result = handleWatchdogVerdict(verdict, deps.getConcurrency(), now, maxRuntimeMs)
    deps.setConcurrency(result.concurrency)

    // Step 2: Flush buffered agent events before the DB write — the batcher
    // timer is not guaranteed to fire before the watchdog kill lands.
    flushAgentEventBatcher()

    // Step 3: Persist the status change to DB before removing from map.
    // If the DB write fails the agent is still gone from the process level,
    // so we remove from the map anyway — but the task stays in `active` in DB
    // until orphan-recovery resets it on the next startup.
    if (result.taskUpdate) {
      try {
        deps.repo.updateTask(agent.taskId, result.taskUpdate)
      } catch (err) {
        deps.logger.warn(
          `[agent-manager] Failed to update task ${agent.taskId} after ${verdict}: ${err}`
        )
      }
    }

    // Step 4: Remove from map only after DB write attempt so the watchdog does
    // not re-kill the same agent on the next tick before the status lands.
    removeAgentFromMap(agent, deps.activeAgents)

    // Step 5: Notify terminal handler after map removal so downstream logic
    // (dep resolution, metrics) sees a consistent state.
    if (result.shouldNotifyTerminal && result.terminalStatus) {
      flushAgentEventBatcher()
      deps
        .onTaskTerminal(agent.taskId, result.terminalStatus)
        .catch((err) =>
          deps.logger.warn(
            `[agent-manager] Failed onTerminal for task ${agent.taskId} after ${verdict}: ${err}`
          )
        )
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fires worktree cleanup for a just-killed agent unless the task is already in
 * `review` status — review worktrees are preserved for human inspection.
 * Errors are caught and logged so cleanup failure never blocks the watchdog.
 */
function cleanupWorktreeIfNotInReview(agent: ActiveAgent, deps: WatchdogLoopDeps): void {
  if (!deps.cleanupAgentWorktree) return

  const task = deps.repo.getTask(agent.taskId)
  if (task?.status === 'review') return

  deps.cleanupAgentWorktree(agent).catch((err) => {
    deps.logger.warn(
      `[agent-manager] Worktree cleanup failed for task ${agent.taskId} after watchdog kill: ${err}`
    )
  })
}
