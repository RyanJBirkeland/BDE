/**
 * Shutdown coordinator — graceful termination, agent abort, and re-queue.
 *
 * Extracted from AgentManagerImpl.stop() so the shutdown sequence can be
 * unit-tested without a full manager instance.
 *
 * The caller is responsible for clearing the timer handles before calling
 * `executeShutdown`; this module only handles the agent-lifecycle portion.
 */

import type { Logger } from '../logger'
import { logError } from '../logger'
import type { ActiveAgent } from './types'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { flushAgentEventBatcher } from '../agent-event-mapper'

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface ShutdownCoordinatorDeps {
  repo: IAgentTaskRepository
  logger: Logger
  activeAgents: Map<string, ActiveAgent>
  agentPromises: Set<Promise<void>>
  drainInFlight: Promise<void> | null
}

// ---------------------------------------------------------------------------
// Shutdown sequence
// ---------------------------------------------------------------------------

/**
 * Graceful shutdown sequence:
 * 1. Wait for any in-flight drain to complete.
 * 2. Abort all active agents.
 * 3. Flush pending agent events to SQLite before awaiting promises.
 * 4. Wait up to `timeoutMs` for all agent promises to settle.
 * 5. Re-queue tasks that are still active after the timeout.
 */
export async function executeShutdown(
  deps: ShutdownCoordinatorDeps,
  timeoutMs: number
): Promise<void> {
  // Wait for any in-flight drain to complete before aborting agents
  if (deps.drainInFlight) {
    await deps.drainInFlight.catch((err) => {
      logError(deps.logger, '[agent-manager] Drain in-flight failed during shutdown', err)
    })
  }

  // Abort all active agents
  for (const agent of deps.activeAgents.values()) {
    try {
      agent.handle.abort()
    } catch (err) {
      deps.logger.warn(
        `[agent-manager] Failed to abort agent ${agent.taskId} during shutdown: ${err}`
      )
    }
  }

  // Flush pending agent events before awaiting promise settlement — ensures events
  // written synchronously before this point are captured rather than lost if a
  // promise settles after the flush window.
  flushAgentEventBatcher()

  // Wait for all agent promises to settle (with timeout)
  if (deps.agentPromises.size > 0) {
    const allSettled = Promise.allSettled([...deps.agentPromises])
    const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
    await Promise.race([allSettled, timeout])
  }

  // Re-queue tasks that are still in an active (non-review) state after shutdown.
  // Tasks already in 'review' status represent completed agent work waiting for
  // human review — they must not be disrupted by a shutdown-triggered re-queue.
  for (const agent of deps.activeAgents.values()) {
    try {
      const currentTask = deps.repo.getTask(agent.taskId)
      if (currentTask?.status === 'review') {
        deps.logger.info(
          `[agent-manager] Skipping re-queue for review task ${agent.taskId} during shutdown`
        )
        continue
      }
      await deps.repo.updateTask(agent.taskId, {
        status: 'queued',
        claimed_by: null,
        started_at: null,
        notes: 'Task was re-queued due to BDE shutdown while agent was running.'
      })
      deps.logger.info(`[agent-manager] Re-queued task ${agent.taskId} during shutdown`)
    } catch (err) {
      deps.logger.warn(`[agent-manager] Failed to re-queue task ${agent.taskId}: ${err}`)
    }
  }
  deps.activeAgents.clear()
}
