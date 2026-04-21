/**
 * Agent manager IPC handlers — delegates to the in-process AgentManager.
 */
import { safeHandle } from '../ipc-utils'
import { isValidTaskId } from '../lib/validation'
import type { AgentManager } from '../agent-manager'
import type { AgentManagerStatus } from '../../shared/types'
import { getTask } from '../services/sprint-service'
import { createLogger, logError } from '../logger'
import { createCheckpoint } from '../services/checkpoint-service'

const log = createLogger('agent-manager-handlers')

const STOPPED_STATUS: AgentManagerStatus = {
  running: false,
  shuttingDown: false,
  concurrency: {
    maxSlots: 0,
    capacityAfterBackpressure: 0,
    activeCount: 0,
    recoveryScheduledAt: null,
    consecutiveRateLimits: 0,
    atMinimumCapacity: false
  },
  activeAgents: []
}

export function registerAgentManagerHandlers(am: AgentManager | undefined): void {
  safeHandle('agent-manager:status', async () => {
    if (!am) return STOPPED_STATUS
    return am.getStatus()
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) return { ok: false, error: 'Invalid task ID format' }
    if (!am) return { ok: false, error: 'Agent manager not available' }
    try {
      am.killAgent(taskId)
      return { ok: true }
    } catch (err) {
      logError(log, `[agent-manager:killAgent] failed for ${taskId}`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeHandle('agent-manager:metrics', async () => {
    return am?.getMetrics() ?? null
  })

  safeHandle('agent-manager:reloadConfig', async () => {
    if (!am) return { updated: [], requiresRestart: [] }
    return am.reloadConfig()
  })

  // /checkpoint — snapshot current worktree state without stopping the agent.
  // Runs `git add -A && git commit -m "<message>"` in the agent's worktree.
  type CheckpointResult = { ok: boolean; committed: boolean; error?: string | undefined }
  type CheckpointHandler = (
    _e: Electron.IpcMainInvokeEvent,
    taskId: string,
    message?: string
  ) => Promise<CheckpointResult>
  const checkpoint: CheckpointHandler = async (_e, taskId, message) => {
    if (!isValidTaskId(taskId))
      return { ok: false, committed: false, error: 'Invalid task ID format' }
    const task = getTask(taskId)
    if (!task) return { ok: false, committed: false, error: `Task ${taskId} not found` }
    const worktreePath = task.worktree_path
    if (!worktreePath) {
      return {
        ok: false,
        committed: false,
        error: 'No worktree path for this task (not a pipeline agent?)'
      }
    }
    return createCheckpoint(taskId, worktreePath, message)
  }
  safeHandle('agent-manager:checkpoint', checkpoint)
}
