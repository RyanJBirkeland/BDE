import type { ActiveAgent, AgentHandle, Logger } from './types'
import { SPAWN_TIMEOUT_MS } from './types'
import { classifyExit } from './fast-fail'
import { cleanupWorktree } from './worktree'
import { spawnAgent } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import { updateTask } from '../data/sprint-queries'
import { getGhRepo } from '../paths'
import { createAgentRecord, updateAgentMeta } from '../agent-history'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunAgentTask {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
}

export interface RunAgentDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isRateLimitMessage(msg: unknown): boolean {
  if (typeof msg !== 'object' || msg === null) return false
  const m = msg as Record<string, unknown>
  return m.type === 'system' && m.subtype === 'rate_limit'
}

export function getNumericField(msg: unknown, field: string): number | undefined {
  if (typeof msg !== 'object' || msg === null) return undefined
  const val = (msg as Record<string, unknown>)[field]
  return typeof val === 'number' ? val : undefined
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps,
): Promise<void> {
  const { activeAgents, defaultModel, logger, onTaskTerminal } = deps

  const prompt = (task.prompt || task.spec || task.title || '').trim()
  if (!prompt) {
    logger.error(`[agent-manager] Task ${task.id} has no prompt/spec/title — marking error`)
    await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString(), notes: 'Empty prompt' })
    await onTaskTerminal(task.id, 'error')
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
    return
  }

  let handle: AgentHandle
  try {
    handle = await Promise.race([
      spawnAgent({
        prompt,
        cwd: worktree.worktreePath,
        model: defaultModel,
        logger,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)), SPAWN_TIMEOUT_MS)),
    ])
  } catch (err) {
    logger.error(`[agent-manager] spawnAgent failed for task ${task.id}: ${err}`)
    await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString(), notes: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` }).catch((err) => logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${err}`))
    await onTaskTerminal(task.id, 'error')
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
    return
  }

  const agentRunId = randomUUID()
  const agent: ActiveAgent = {
    taskId: task.id,
    agentRunId,
    handle,
    model: defaultModel,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  }
  activeAgents.set(task.id, agent)
  // Persist agent_run_id so LogDrawer can find logs after restart
  await updateTask(task.id, { agent_run_id: agentRunId }).catch((err) =>
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  )
  // Persist agent run to local SQLite for log access and history
  createAgentRecord({
    id: agentRunId,
    pid: null,
    bin: 'claude',
    model: defaultModel,
    repo: task.repo,
    repoPath: worktree.worktreePath,
    task: prompt,
    startedAt: new Date(agent.startedAt).toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: task.id,
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`)
  )
  // activeCount is derived from activeAgents.size — no manual increment needed

  // Consume messages
  let exitCode: number | undefined
  try {
    for await (const msg of handle.messages) {
      agent.lastOutputAt = Date.now()

      // Track rate-limit events
      if (isRateLimitMessage(msg)) {
        agent.rateLimitCount++
      }
      // Track cost / tokens if present
      agent.costUsd = getNumericField(msg, 'cost_usd') ?? agent.costUsd
      agent.tokensIn = getNumericField(msg, 'tokens_in') ?? agent.tokensIn
      agent.tokensOut = getNumericField(msg, 'tokens_out') ?? agent.tokensOut
      // Track exit code if present (typically in last message)
      exitCode = getNumericField(msg, 'exit_code') ?? exitCode
    }
  } catch (err) {
    logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
  }

  // Agent exited
  const exitedAt = Date.now()

  // Check if watchdog already cleaned up this agent
  if (!activeAgents.has(task.id)) {
    logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
    })
    return
  }

  activeAgents.delete(task.id)
  // activeCount is derived from activeAgents.size — no manual decrement needed

  // Update agent run record with final state
  updateAgentMeta(agentRunId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date(exitedAt).toISOString(),
    exitCode: exitCode ?? null,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to update agent record for ${agentRunId}: ${err}`)
  )

  // Classify exit (default to exit code 1 if not available, assuming failure)
  const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
  const now = new Date().toISOString()

  if (ffResult === 'fast-fail-exhausted') {
    await updateTask(task.id, { status: 'error', completed_at: now, notes: 'Fast-fail exhausted' })
      .catch((err) => logger.error(`[agent-manager] Failed to update task ${task.id} after fast-fail exhausted: ${err}`))
    await onTaskTerminal(task.id, 'error')
  } else if (ffResult === 'fast-fail-requeue') {
    await updateTask(task.id, {
      status: 'queued',
      fast_fail_count: (task.fast_fail_count ?? 0) + 1,
      claimed_by: null,
    }).catch((err) => logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`))
  } else {
    // Normal exit — attempt success resolution
    try {
      const ghRepo = getGhRepo(task.repo) ?? task.repo

      await resolveSuccess({
        taskId: task.id,
        worktreePath: worktree.worktreePath,
        title: task.title,
        ghRepo,
        onTaskTerminal,
      }, logger)
    } catch (err) {
      logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
      const isTerminal = await resolveFailure({ taskId: task.id, retryCount: task.retry_count ?? 0 }, logger)
      if (isTerminal) {
        await onTaskTerminal(task.id, 'failed')
      }
    }
  }

  // Cleanup worktree (fire-and-forget)
  cleanupWorktree({
    repoPath,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch,
  })

  logger.info(`[agent-manager] Agent completed for task ${task.id} (${ffResult})`)
}
