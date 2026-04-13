import type { ActiveAgent, AgentHandle } from './types'
import type { Logger } from '../logger'
import { logError } from '../logger'
import { LAST_OUTPUT_MAX_LENGTH } from './types'
import { classifyExit } from './fast-fail'
import { cleanupWorktree } from './worktree'
import { asSDKMessage, getNumericField, isRateLimitMessage, spawnWithTimeout } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getGhRepo, BDE_TASK_MEMORY_DIR } from '../paths'
import { createAgentRecord, updateAgentMeta } from '../agent-history'
import { updateAgentRunCost } from '../data/agent-queries'
import { getDb } from '../db'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapRawMessage, emitAgentEvent } from '../agent-event-mapper'
import type { TaskDependency } from '../../shared/types'
import { buildAgentPrompt } from './prompt-composer'
import { TurnTracker } from './turn-tracker'
import { nowIso } from '../../shared/time'
import { detectHtmlWrite, tryEmitPlaygroundEvent } from './playground-handler'
import { capturePartialDiff } from './partial-diff-capture'

export interface RunAgentTask {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
  notes?: string | null
  playground_enabled?: boolean
  max_runtime_ms?: number | null
  max_cost_usd?: number | null
  model?: string | null
  depends_on?: TaskDependency[] | null
  cross_repo_contract?: string | null
}

/** Spawn lifecycle and agent process management. */
export interface RunAgentSpawnDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  /** Optional — called when agent process successfully spawns. */
  onSpawnSuccess?: () => void
  /** Optional — called when spawnAgent throws. */
  onSpawnFailure?: () => void
}

/** Sprint task data access. */
export interface RunAgentDataDeps {
  repo: ISprintTaskRepository
  logger: Logger
}

/** Terminal status notification. */
export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  logger: Logger
}

/**
 * Full dependency bag for runAgent(). Composed via intersection so callers
 * that only consume a sub-set can depend on the narrower interface.
 */
export type RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps


export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
}

/**
 * Handles OAuth token refresh after auth errors.
 */
async function handleOAuthRefresh(logger: Logger): Promise<void> {
  const { invalidateOAuthToken, refreshOAuthTokenFromKeychain } = await import('../env-utils')
  invalidateOAuthToken()
  refreshOAuthTokenFromKeychain()
    .then((ok) => {
      if (ok)
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain after auth failure')
    })
    .catch((err) => {
      logError(logger, '[agent-manager] Failed to auto-refresh OAuth token after auth failure', err)
    })
  logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
}

/**
 * Updates agent cost and token fields from SDK message.
 */
function trackAgentCosts(msg: unknown, agent: ActiveAgent, turnTracker: TurnTracker): void {
  agent.costUsd =
    getNumericField(msg, 'cost_usd') ?? getNumericField(msg, 'total_cost_usd') ?? agent.costUsd
  turnTracker.processMessage(msg)
  const { tokensIn, tokensOut } = turnTracker.totals()
  agent.tokensIn = tokensIn
  agent.tokensOut = tokensOut
}

/**
 * Detects HTML writes and emits playground events if enabled.
 */
function detectPlaygroundWrite(
  msg: unknown,
  task: RunAgentTask,
  worktreePath: string,
  logger: Logger
): void {
  if (!task.playground_enabled) return
  const htmlPath = detectHtmlWrite(msg)
  if (htmlPath) {
    tryEmitPlaygroundEvent(task.id, htmlPath, worktreePath, logger).catch((err) => {
      logger.warn(`[run-agent] playground emit failed for task ${task.id}: ${err}`)
    })
  }
}

/**
 * Processes a single message: tracks costs, emits events, detects playground.
 */
function processSDKMessage(
  msg: unknown,
  agent: ActiveAgent,
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger,
  exitCode: number | undefined,
  lastAgentOutput: string
): { exitCode: number | undefined; lastAgentOutput: string } {
  agent.lastOutputAt = Date.now()

  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++
  }

  trackAgentCosts(msg, agent, turnTracker)
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode

  const mappedEvents = mapRawMessage(msg)
  for (const event of mappedEvents) {
    emitAgentEvent(agentRunId, event)
  }

  detectPlaygroundWrite(msg, task, worktreePath, logger)

  const m = asSDKMessage(msg)
  if (m?.type === 'assistant' && typeof m.text === 'string') {
    lastAgentOutput = m.text.slice(-LAST_OUTPUT_MAX_LENGTH)
  }

  return { exitCode, lastAgentOutput }
}

/**
 * Consumes SDK message stream, tracking costs, emitting events, and detecting playground writes.
 */
export async function consumeMessages(
  handle: AgentHandle,
  agent: ActiveAgent,
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger
): Promise<ConsumeMessagesResult> {
  let exitCode: number | undefined
  let lastAgentOutput = ''

  try {
    for await (const msg of handle.messages) {
      const result = processSDKMessage(
        msg,
        agent,
        task,
        worktreePath,
        agentRunId,
        turnTracker,
        logger,
        exitCode,
        lastAgentOutput
      )
      exitCode = result.exitCode
      lastAgentOutput = result.lastAgentOutput
    }
  } catch (err) {
    logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    // Emit error event for console display
    emitAgentEvent(agentRunId, {
      type: 'agent:error',
      message: errMsg,
      timestamp: Date.now()
    })
    // Invalidate cached OAuth token on auth errors so next agent gets a fresh token
    if (
      errMsg.includes('Invalid API key') ||
      errMsg.includes('invalid_api_key') ||
      errMsg.includes('authentication')
    ) {
      await handleOAuthRefresh(logger)
    }
  }

  return { exitCode, lastAgentOutput }
}

/**
 * Phase 1: Validates task content and prepares the agent prompt.
 * Throws if task has no content (early validation failure).
 */
/**
 * Validation phase: verifies the task has executable content.
 * On failure, transitions the task to 'error' status, calls onTaskTerminal,
 * and cleans up the worktree before throwing 'Task has no content'.
 * Has side effects — do NOT call this more than once per task run.
 */
export async function validateTaskForRun(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger, repo, onTaskTerminal } = deps
  const taskContent = (task.prompt || task.spec || task.title || '').trim()
  if (!taskContent) {
    logger.error(`[agent-manager] Task ${task.id} has no prompt/spec/title — marking error`)
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: nowIso(),
      notes:
        'Agent failed to start: task has no prompt, spec, or title. To fix: edit the task and provide a prompt or spec describing what the agent should do.',
      claimed_by: null
    })
    await onTaskTerminal(task.id, 'error')
    try {
      await cleanupWorktree({
        repoPath,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        logger
      })
    } catch (cleanupErr) {
      logger.warn(
        `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`
      )
    }
    throw new Error('Task has no content')
  }
}

/**
 * Context assembly phase: builds the agent prompt string from task data.
 * Pure function — no side effects, no task mutations, no callbacks.
 */
export async function assembleRunContext(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  deps: RunAgentDeps
): Promise<string> {
  const { logger, repo } = deps
  const taskContent = (task.prompt || task.spec || task.title || '').trim()

  // Fetch upstream task specs for context propagation
  const upstreamContext: Array<{ title: string; spec: string; partial_diff?: string }> = []
  if (task.depends_on && task.depends_on.length > 0) {
    for (const dep of task.depends_on) {
      try {
        const upstreamTask = repo.getTask(dep.id)
        if (upstreamTask && upstreamTask.status === 'done') {
          const spec = upstreamTask.spec || upstreamTask.prompt || ''
          if (spec.trim()) {
            upstreamContext.push({
              title: upstreamTask.title,
              spec: spec.trim(),
              partial_diff: upstreamTask.partial_diff || undefined
            })
          }
        }
      } catch (err) {
        logger.warn(`[agent-manager] Failed to fetch upstream task ${dep.id}: ${err}`)
      }
    }
  }

  // Create task scratchpad directory (idempotent)
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, task.id)
  mkdirSync(scratchpadDir, { recursive: true })

  // Read prior scratchpad content if present
  let priorScratchpad = ''
  try {
    priorScratchpad = readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    // Expected on first run
  }

  return buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled,
    retryCount: task.retry_count ?? 0,
    previousNotes: task.notes ?? undefined,
    maxRuntimeMs: task.max_runtime_ms ?? undefined,
    upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
    crossRepoContract: task.cross_repo_contract ?? undefined,
    repoName: task.repo,
    taskId: task.id,
    priorScratchpad
  })
}

async function validateAndPreparePrompt(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<string> {
  await validateTaskForRun(task, worktree, repoPath, deps)
  return assembleRunContext(task, worktree, deps)
}

/**
 * Phase 2: Spawns the agent and initializes tracking infrastructure.
 * Returns the active agent and turn tracker, or throws on spawn failure.
 */
async function spawnAndWireAgent(
  task: RunAgentTask,
  prompt: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  effectiveModel: string,
  deps: RunAgentDeps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onTaskTerminal, onSpawnSuccess, onSpawnFailure } = deps

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    try {
      onSpawnSuccess?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
    try {
      onSpawnFailure?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnFailure hook threw: ${cbErr}`)
    }
    logError(logger, `[agent-manager] spawnAgent failed for task ${task.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    emitAgentEvent(task.id, {
      type: 'agent:error',
      message: `Spawn failed: ${errMsg}`,
      timestamp: Date.now()
    })
    try {
      repo.updateTask(task.id, {
        status: 'error',
        completed_at: nowIso(),
        notes: `Spawn failed: ${errMsg}`,
        claimed_by: null
      })
    } catch (updateErr) {
      logger.warn(
        `[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`
      )
    }
    await onTaskTerminal(task.id, 'error')
    try {
      await cleanupWorktree({
        repoPath,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        logger
      })
    } catch (cleanupErr) {
      logger.warn(
        `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`
      )
    }
    throw err
  }

  const agentRunId = randomUUID()

  // Wire stderr capture
  handle.onStderr = (line: string) => {
    emitAgentEvent(agentRunId, { type: 'agent:stderr', text: line, timestamp: Date.now() })
  }

  const agent: ActiveAgent = {
    taskId: task.id,
    agentRunId,
    handle,
    model: effectiveModel,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: task.max_runtime_ms ?? null,
    maxCostUsd: task.max_cost_usd ?? null
  }

  activeAgents.set(task.id, agent)
  const turnTracker = new TurnTracker(agentRunId)

  // Persist agent_run_id
  try {
    repo.updateTask(task.id, { agent_run_id: agentRunId })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  }

  // Persist agent run to SQLite
  createAgentRecord({
    id: agentRunId,
    pid: null,
    bin: 'claude',
    model: effectiveModel,
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
    cacheRead: null,
    cacheCreate: null,
    sprintTaskId: task.id,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`)
  )

  // Emit agent:started event
  emitAgentEvent(agentRunId, {
    type: 'agent:started',
    model: effectiveModel,
    timestamp: Date.now()
  })

  return { agent, agentRunId, turnTracker }
}

/**
 * Phase 3: Finalizes agent run — emits completion event, classifies exit,
 * runs resolution handlers, and cleans up resources.
 */
async function finalizeAgentRun(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  agent: ActiveAgent,
  agentRunId: string,
  turnTracker: TurnTracker,
  exitCode: number | undefined,
  lastAgentOutput: string,
  deps: RunAgentDeps
): Promise<void> {
  const { activeAgents, logger, repo, onTaskTerminal } = deps

  const exitedAt = Date.now()
  const durationMs = exitedAt - agent.startedAt

  // Emit completion event
  emitAgentEvent(agentRunId, {
    type: 'agent:completed',
    exitCode: exitCode ?? 0,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    durationMs,
    timestamp: exitedAt
  })

  // Check if watchdog already cleaned up
  if (!activeAgents.has(task.id)) {
    logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
    }).catch((cleanupErr: unknown) => {
      logger.warn(
        `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`
      )
    })
    return
  }

  // Update agent run record
  updateAgentMeta(agentRunId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date(exitedAt).toISOString(),
    exitCode: exitCode ?? null,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to update agent record for ${agentRunId}: ${err}`)
  )

  // Persist cost breakdown
  try {
    const totals = turnTracker.totals()
    updateAgentRunCost(getDb(), agentRunId, {
      costUsd: agent.costUsd ?? 0,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      cacheRead: totals.cacheTokensRead,
      cacheCreate: totals.cacheTokensCreated,
      durationMs,
      numTurns: totals.turnCount
    })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist cost breakdown for ${agentRunId}: ${err}`)
  }

  // Classify exit
  const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
  const now = nowIso()

  if (ffResult === 'fast-fail-exhausted') {
    try {
      repo.updateTask(task.id, {
        status: 'error',
        completed_at: now,
        notes:
          "Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by.",
        claimed_by: null,
        needs_review: true
      })
    } catch (err) {
      logger.error(
        `[agent-manager] Failed to update task ${task.id} after fast-fail exhausted: ${err}`
      )
    }
    await onTaskTerminal(task.id, 'error')
  } else if (ffResult === 'fast-fail-requeue') {
    try {
      repo.updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null
      })
    } catch (err) {
      logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`)
    }
  } else {
    // Normal exit — attempt success resolution
    try {
      const ghRepo = getGhRepo(task.repo) ?? task.repo
      await resolveSuccess(
        {
          taskId: task.id,
          worktreePath: worktree.worktreePath,
          title: task.title,
          ghRepo,
          onTaskTerminal,
          agentSummary: lastAgentOutput || null,
          retryCount: task.retry_count ?? 0,
          repo
        },
        logger
      )
    } catch (err) {
      logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
      const isTerminal = resolveFailure(
        { taskId: task.id, retryCount: task.retry_count ?? 0, repo },
        logger
      )
      if (isTerminal) {
        await onTaskTerminal(task.id, 'failed')
      }
    }
  }

  // Remove from active map
  activeAgents.delete(task.id)

  // Cleanup worktree (preserve for review tasks)
  const currentTask = repo.getTask(task.id)
  if (currentTask?.status !== 'review') {
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
    }).catch((cleanupErr: unknown) => {
      logger.warn(
        `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`
      )
    })
  } else {
    logger.info(
      `[agent-manager] Preserving worktree for review task ${task.id} at ${worktree.worktreePath}`
    )
  }

  logger.info(`[agent-manager] Agent completed for task ${task.id} (${ffResult})`)
}

export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger } = deps
  const effectiveModel = task.model || deps.defaultModel

  // Phase 1: Validate and prepare prompt
  let prompt: string
  try {
    prompt = await validateAndPreparePrompt(task, worktree, repoPath, deps)
  } catch {
    return // Early exit — validation failed and cleaned up
  }

  // Phase 2: Spawn and wire agent
  let agent: ActiveAgent, agentRunId: string, turnTracker: TurnTracker
  try {
    const result = await spawnAndWireAgent(task, prompt, worktree, repoPath, effectiveModel, deps)
    agent = result.agent
    agentRunId = result.agentRunId
    turnTracker = result.turnTracker
  } catch {
    return // Early exit — spawn failed and cleaned up
  }

  // Phase 3: Consume messages
  const { exitCode, lastAgentOutput } = await consumeMessages(
    agent.handle,
    agent,
    task,
    worktree.worktreePath,
    agentRunId,
    turnTracker,
    logger
  )

  // Phase 4: Finalize — classify exit, resolve, cleanup
  await finalizeAgentRun(
    task,
    worktree,
    repoPath,
    agent,
    agentRunId,
    turnTracker,
    exitCode,
    lastAgentOutput,
    deps
  )
}
