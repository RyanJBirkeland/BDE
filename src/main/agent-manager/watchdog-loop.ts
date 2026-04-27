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
import type { TaskStatus } from '../../shared/task-state-machine'
import { withRetryAsync } from '../data/sqlite-retry'

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
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  /**
   * Optional hook to clean up the agent's git worktree after a watchdog kill.
   * Called only when the task is NOT in `review` status (review worktrees are
   * preserved for human inspection). Errors are caught and logged by the caller.
   */
  cleanupAgentWorktree?: (agent: ActiveAgent) => Promise<void>
  /**
   * Optional broadcast function for sending warning events to the renderer.
   * Used when the watchdog DB write fails after all retries — surfaces the
   * issue to the operator without triggering dependency resolution.
   */
  broadcastToRenderer?: (channel: string, payload: unknown) => void
}

// ---------------------------------------------------------------------------
// Kill helpers — soft / force / escalation
// ---------------------------------------------------------------------------

/**
 * Grace window between the soft `abort()` signal and the SIGKILL escalation.
 * Five seconds is long enough for the SDK / CLI to flush in-flight output and
 * exit cleanly, but short enough that an unresponsive agent does not pin the
 * watchdog slot indefinitely.
 */
export const FORCE_KILL_DELAY_MS = 5_000

/**
 * Send the soft-abort signal to an agent. SDK and CLI handles both treat
 * `abort()` as a graceful-exit request — the agent gets a chance to flush
 * stdout/stderr and tear down child processes before the OS-level kill.
 */
export function softKillAgent(agent: ActiveAgent, logger: Logger): void {
  try {
    agent.handle.abort()
  } catch (err) {
    logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
  }
}

/**
 * Force-terminate an agent that did not exit within the soft-kill grace
 * window. Prefers the handle's own `forceKill()` when implemented; falls back
 * to SIGKILL on any exposed subprocess; finally re-issues `abort()` so SDK
 * paths still receive the cancellation signal even when no process handle
 * exists. Always emits an explicit "forceKill applied after soft kill
 * timeout" log line so operators can correlate with stuck-agent reports.
 */
export function forceKillAgent(agent: ActiveAgent, logger: Logger): void {
  logger.warn(
    `[agent-manager] forceKill applied after soft kill timeout for task ${agent.taskId}`
  )
  try {
    if (typeof agent.handle.forceKill === 'function') {
      agent.handle.forceKill()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (agent.handle as any).process
    if (proc && typeof proc.kill === 'function') {
      proc.kill('SIGKILL')
      return
    }
    // SDK paths without a subprocess: re-issue abort so the cancellation
    // token fires even if the soft-kill abort threw earlier.
    agent.handle.abort()
  } catch (err) {
    logger.warn(`[agent-manager] Failed to forceKill agent ${agent.taskId}: ${err}`)
  }
}

/**
 * Soft-kill the agent now and schedule a forced kill after the grace window
 * if the agent is still in `activeAgents`. The returned timer handle is
 * `unref()`'d so it never blocks process shutdown — pipeline tests that exit
 * during the grace window do not hang on a pending timeout.
 */
export function killAgentWithEscalation(
  agent: ActiveAgent,
  activeAgents: Map<string, ActiveAgent>,
  logger: Logger,
  delayMs: number = FORCE_KILL_DELAY_MS
): NodeJS.Timeout {
  softKillAgent(agent, logger)
  const timer = setTimeout(() => {
    if (activeAgents.get(agent.taskId)?.agentRunId !== agent.agentRunId) return
    forceKillAgent(agent, logger)
  }, delayMs)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

/**
 * Backward-compatible wrapper. Callers that don't track the active-agents
 * map (e.g. tests, manual cleanup paths) still get the soft + force behavior
 * without the escalation timer — they invoke both signals immediately.
 */
export function abortAgent(agent: ActiveAgent, logger: Logger): void {
  softKillAgent(agent, logger)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (agent.handle as any).process
  if (proc && typeof proc.kill === 'function') {
    try {
      proc.kill('SIGKILL')
    } catch (err) {
      logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
    }
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
    // Idempotency guard: orphan recovery may have already removed this agent
    // from the active map and triggered terminal notification between the time
    // we collected agentsToKill and now. If the entry is gone (or has been
    // replaced by a newer retry), skip the kill path to prevent double-notify.
    if (deps.activeAgents.get(agent.taskId)?.agentRunId !== agent.agentRunId) {
      deps.logger.debug(
        `[watchdog] agent ${agent.taskId} (run ${agent.agentRunId}) already removed — skipping terminal notify`
      )
      continue
    }

    const runtimeMs = Date.now() - agent.startedAt
    const limitMs = agent.maxRuntimeMs ?? deps.config.maxRuntimeMs
    deps.logger.event('agent.watchdog.kill', {
      taskId: agent.taskId,
      runtimeMs,
      limitMs,
      agentType: 'pipeline',
      verdict
    })
    deps.metrics.recordWatchdogVerdict(verdict)
    if (verdict === 'rate-limit-loop') {
      deps.metrics.increment('retriesQueued')
    }

    // Step 1: Soft-kill the agent and arm the forceKill escalation.
    // The watchdog hands control to the cleanup/DB-write steps immediately;
    // if the agent has not exited by FORCE_KILL_DELAY_MS the timer fires a
    // SIGKILL (or the SDK abort fallback) so a stuck process never pins the
    // active-agents slot indefinitely.
    killAgentWithEscalation(agent, deps.activeAgents, deps.logger)
    cleanupWorktreeIfNotInReview(agent, deps)

    const now = nowIso()
    const maxRuntimeMs = agent.maxRuntimeMs ?? deps.config.maxRuntimeMs
    const result = handleWatchdogVerdict(verdict, deps.getConcurrency(), now, maxRuntimeMs)
    deps.setConcurrency(result.concurrency)

    // Step 2: Flush buffered agent events before the DB write — the batcher
    // timer is not guaranteed to fire before the watchdog kill lands.
    flushAgentEventBatcher()

    // Step 3: Persist the status change to DB before removing from map.
    // Retries SQLITE_BUSY transparently. If all retries are exhausted, broadcast
    // a warning and return early — never call onTaskTerminal when the DB write
    // did not land, as that would unblock dependents against a task still `active`.
    if (result.taskUpdate) {
      let writeSucceeded = false
      try {
        // EP-1 note: result.taskUpdate may include a `status` field from watchdog-handler.ts.
        // Migrating to TaskStateService.transition() here requires async handling and
        // threading taskStateService through WatchdogLoopDeps. Deferred to EP-2.
        await withRetryAsync(() => deps.repo.updateTask(agent.taskId, result.taskUpdate!))
        writeSucceeded = true
      } catch (err) {
        deps.logger.warn(
          `[agent-manager] Failed to update task ${agent.taskId} after ${verdict}: ${err}`
        )
        const warningMessage = `Watchdog kill for task ${agent.taskId} could not be persisted after all retries — manual rescue may be needed. Error: ${err}`
        deps.broadcastToRenderer?.('manager:warning', { message: warningMessage })
        removeAgentFromMap(agent, deps.activeAgents)
        return
      }

      if (!writeSucceeded) return
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
