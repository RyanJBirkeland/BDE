/**
 * Agent IPC handlers — manages agent lifecycle operations
 * and provides local history/log access from SQLite.
 */
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { safeHandle } from '../ipc-utils'
import { tailAgentLog, cleanupOldLogs } from '../agent-log-manager'
import type { TailLogArgs } from '../agent-log-manager'
import { listAgents, readLog, importAgent, pruneOldAgents, getAgentMeta } from '../agent-history'
import { getLatestAgentRunTurn } from '../data/agent-queries'
import { getDb } from '../db'
import type { AgentMeta } from '../agent-history'
import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import { createReviewTaskFromAdhoc } from '../services/sprint-service'
import { buildAgentEnv } from '../env-utils'
import { createLogger, logError } from '../logger'
import type { SpawnLocalAgentArgs } from '../../shared/types'
import type { AgentManager } from '../agent-manager'
import { createSprintTaskRepository } from '../data/sprint-task-repository'

const execFileAsync = promisify(execFileCb)
const log = createLogger('agent-handlers')

export interface PromoteToReviewResult {
  ok: boolean
  taskId?: string
  error?: string
}

export function registerAgentHandlers(am?: AgentManager): void {
  const repo = createSprintTaskRepository()

  safeHandle('local:getAgentProcesses', async () => {
    return []
  })
  safeHandle('local:spawnClaudeAgent', async (_e, args: SpawnLocalAgentArgs) => {
    return spawnAdhocAgent({
      task: args.task,
      repoPath: args.repoPath,
      model: args.model,
      assistant: args.assistant,
      repo
    })
  })
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('agent:steer', async (
      _e,
      {
        agentId,
        message,
        images
      }: { agentId: string; message: string; images?: Array<{ data: string; mimeType: string }> }
    ) => {
      // Try ad-hoc agents first
      const adhocHandle = getAdhocHandle(agentId)
      if (adhocHandle) {
        try {
          await adhocHandle.send(message, images)
          return { ok: true }
        } catch (err) {
          logError(log, '[agents:send] adhoc send failed', err)
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
      // Try local AgentManager
      if (am) {
        const result = await am.steerAgent(agentId, message)
        if (result.delivered) return { ok: true }
        return { ok: false, error: result.error }
      }
      return { ok: false, error: 'No agent manager available' }
    }
  )
  safeHandle('agent:kill', async (_e, agentId: string) => {
    // Try ad-hoc agents first
    const adhocHandle = getAdhocHandle(agentId)
    if (adhocHandle) {
      adhocHandle.close()
      return { ok: true }
    }
    if (am) {
      try {
        am.killAgent(agentId)
        return { ok: true }
      } catch (err) {
        logError(log, `[killAgent] exception for ${agentId}`, err)
        /* fall through */
      }
    }
    return { ok: false, error: 'Agent not found' }
  })
  safeHandle('agent:history', async (_e, agentId: string) => {
    // Event history from local SQLite — kept for viewing historical runs
    const { getEventHistory } = await import('../data/event-queries')
    const { getDb } = await import('../db')
    const rows = getEventHistory(getDb(), agentId)
    return rows.map((r) => JSON.parse(r.payload))
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  safeHandle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  safeHandle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  safeHandle('agents:import', (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
    importAgent(args.meta, args.content)
  )

  /**
   * Promote a completed adhoc agent's worktree into the Code Review queue.
   *
   * Adhoc agents are scratchpads — they don't participate in the sprint task
   * lifecycle. When the user is happy with an adhoc agent's work and wants it
   * reviewed/merged, they click "Promote to Code Review" which calls this
   * handler. We:
   *  1. Look up the agent and verify it has a worktree with at least one commit
   *  2. Create a NEW sprint task in `review` status pointing at that worktree
   *  3. Return the new task id so the UI can switch to Code Review and select it
   */
  safeHandle('agents:promoteToReview', async (_e, agentId: string): Promise<PromoteToReviewResult> => {
      try {
        const agent = await getAgentMeta(agentId)
        if (!agent) {
          return { ok: false, error: `Agent ${agentId} not found` }
        }
        if (!agent.worktreePath) {
          return {
            ok: false,
            error:
              'Agent has no worktree — only adhoc agents spawned with worktree support can be promoted'
          }
        }
        if (!existsSync(agent.worktreePath)) {
          return { ok: false, error: `Worktree no longer exists at ${agent.worktreePath}` }
        }
        if (!agent.branch) {
          return { ok: false, error: 'Agent has no branch recorded' }
        }

        // Verify the worktree has at least one commit beyond main — otherwise
        // there's nothing to review.
        const env = buildAgentEnv()
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['rev-list', '--count', `origin/main..${agent.branch}`],
            { cwd: agent.worktreePath, env }
          )
          const commitCount = parseInt(stdout.trim(), 10)
          if (!Number.isFinite(commitCount) || commitCount === 0) {
            return {
              ok: false,
              error: 'Agent has not committed any work yet — nothing to promote'
            }
          }
        } catch (err) {
          log.warn(`[agents:promoteToReview] commit count check failed: ${err}`)
          // Non-fatal — proceed anyway; the review UI will handle empty diffs
        }

        // Derive a title from the agent's task message (first non-blank line, capped)
        const firstLine =
          agent.task
            .split('\n')
            .find((l) => l.trim())
            ?.trim() ?? 'Promoted adhoc agent'
        const title = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine

        const task = createReviewTaskFromAdhoc({
          title,
          repo: agent.repo,
          spec: agent.task,
          worktreePath: agent.worktreePath,
          branch: agent.branch
        })

        if (!task) {
          return { ok: false, error: 'Failed to create review task — see logs' }
        }

        log.info(`[agents:promoteToReview] Promoted agent ${agentId} → sprint task ${task.id}`)
        return { ok: true, taskId: task.id }
      } catch (err) {
        logError(log, '[agents:promoteToReview] failed', err)
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      }
    }
  )

  safeHandle('agent:latestCacheTokens', async (_e, runId: string) => {
    return getLatestAgentRunTurn(getDb(), runId)
  })

  pruneOldAgents()
}
