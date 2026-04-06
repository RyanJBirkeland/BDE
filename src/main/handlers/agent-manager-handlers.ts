/**
 * Agent manager IPC handlers — delegates to the in-process AgentManager.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { safeHandle } from '../ipc-utils'
import type { AgentManager } from '../agent-manager'
import type { AgentManagerStatus } from '../../shared/types'
import { getTask } from '../data/sprint-queries'

const execFileAsync = promisify(execFile)

const STOPPED_STATUS: AgentManagerStatus = {
  running: false,
  shuttingDown: false,
  concurrency: {
    maxSlots: 0,
    effectiveSlots: 0,
    activeCount: 0,
    recoveryDueAt: null,
    consecutiveRateLimits: 0,
    atFloor: false
  },
  activeAgents: []
}

export function registerAgentManagerHandlers(am: AgentManager | undefined): void {
  safeHandle('agent-manager:status', async () => {
    if (!am) return STOPPED_STATUS
    return am.getStatus()
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    if (!am) throw new Error('Agent manager not available')
    am.killAgent(taskId)
    return { ok: true }
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
  safeHandle(
    'agent-manager:checkpoint',
    async (
      _e,
      taskId: string,
      message?: string
    ): Promise<{ ok: boolean; committed: boolean; error?: string }> => {
      try {
        const task = getTask(taskId)
        if (!task) return { ok: false, committed: false, error: `Task ${taskId} not found` }
        const cwd = task.worktree_path
        if (!cwd) {
          return {
            ok: false,
            committed: false,
            error: 'No worktree path for this task (not a pipeline agent?)'
          }
        }

        // Stage everything
        await execFileAsync('git', ['add', '-A'], { cwd, encoding: 'utf-8' })

        // Check for anything to commit
        const { stdout: diff } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
          cwd,
          encoding: 'utf-8'
        })
        if (!diff.trim()) {
          return { ok: true, committed: false, error: 'Nothing to commit' }
        }

        const msg = (message && message.trim()) || 'checkpoint: user-requested snapshot'
        await execFileAsync('git', ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
        return { ok: true, committed: true }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        // Friendly message when the agent is mid-write and git is holding
        // the index lock. The user can just retry.
        const friendly = /index\.lock/i.test(raw)
          ? 'Agent is currently writing — try again in a moment'
          : raw
        return { ok: false, committed: false, error: friendly }
      }
    }
  )
}
