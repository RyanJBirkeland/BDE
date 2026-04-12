import type { ActiveAgent, AgentHandle } from './types'
import type { Logger } from '../logger'
import { SPAWN_TIMEOUT_MS, LAST_OUTPUT_MAX_LENGTH } from './types'
import { classifyExit } from './fast-fail'
import { cleanupWorktree } from './worktree'
import { spawnAgent, asSDKMessage, getNumericField, isRateLimitMessage } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getGhRepo, BDE_TASK_MEMORY_DIR } from '../paths'
import { createAgentRecord, updateAgentMeta } from '../agent-history'
import { updateAgentRunCost } from '../data/agent-queries'
import { getDb } from '../db'
import { randomUUID } from 'node:crypto'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'
import { broadcast } from '../broadcast'
import { mapRawMessage, emitAgentEvent } from '../agent-event-mapper'
import type { AgentEvent, TaskDependency } from '../../shared/types'
import { buildAgentPrompt } from './prompt-composer'
import { sanitizePlaygroundHtml } from '../playground-sanitize'
import { TurnTracker } from './turn-tracker'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'

const execFile = promisify(execFileCb)

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

export interface RunAgentDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  repo: ISprintTaskRepository
  /** Optional hook called when an agent process is successfully spawned. */
  onSpawnSuccess?: () => void
  /** Optional hook called when spawnAgent throws (broken SDK/CLI, etc). */
  onSpawnFailure?: () => void
}

const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_PARTIAL_DIFF_SIZE = 50 * 1024 // 50KB

/**
 * Detects if a message is a tool_result for a Write tool that created an .html file.
 * Returns the file path if detected, null otherwise.
 */
export function detectHtmlWrite(msg: unknown): string | null {
  const m = asSDKMessage(msg)
  if (!m) return null

  // Check if this is a tool_result or result message
  if (m.type !== 'tool_result' && m.type !== 'result') return null

  // Check if the tool is Write (case-insensitive)
  const toolName = m.tool_name ?? m.name ?? ''
  if (toolName.toLowerCase() !== 'write') return null

  // Extract file path from the tool input or output
  // The Write tool typically has input with { file_path: "..." }
  const filePath = m.input?.file_path as string | undefined

  if (!filePath || extname(filePath).toLowerCase() !== '.html') return null

  return filePath
}

/**
 * Attempts to read an HTML file and emit a playground event.
 * Silently fails if the file doesn't exist or is too large.
 */
export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  try {
    // Resolve absolute path
    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)

    // Validate path is within worktree (prevent traversal)
    const { resolve } = await import('node:path')
    const resolvedPath = resolve(absolutePath)
    const resolvedWorktree = resolve(worktreePath)
    if (!resolvedPath.startsWith(resolvedWorktree)) {
      logger.warn(`[playground] Path traversal blocked: ${filePath} (resolved to ${resolvedPath})`)
      return
    }

    // Check file size
    const stats = await stat(absolutePath)
    if (stats.size > MAX_PLAYGROUND_SIZE) {
      logger.warn(`[playground] File too large (${stats.size} bytes), skipping: ${filePath}`)
      return
    }

    // Read and sanitize file content
    const rawHtml = await readFile(absolutePath, 'utf-8')
    const sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
    const filename = basename(absolutePath)

    // Emit playground event with sanitized HTML
    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html: sanitizedHtml,
      sizeBytes: stats.size,
      timestamp: Date.now()
    }

    broadcast('agent:event', { agentId: taskId, event })
    logger.info(`[playground] Emitted playground event for ${filename} (${stats.size} bytes)`)
  } catch (err) {
    logger.warn(`[playground] Failed to read HTML file ${filePath}: ${err}`)
    // Silently ignore — file may not exist yet or may be inaccessible
  }
}

export type DiffCaptureErrorClass =
  | 'git-missing' // ENOENT on spawn — git binary not on PATH
  | 'no-head' // agent has no commits yet — expected, benign
  | 'not-a-repo' // cwd is not a git repository — unusual but benign
  | 'max-buffer' // diff exceeded maxBuffer — expected, we cap at 50KB
  | 'unknown' // other — needs investigation

export function classifyDiffCaptureError(err: unknown): DiffCaptureErrorClass {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return 'git-missing'
  const msg = (err as Error | null)?.message ?? ''
  if (/unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(msg)) return 'no-head'
  if (/not a git repository/i.test(msg)) return 'not-a-repo'
  if (/maxBuffer/i.test(msg)) return 'max-buffer'
  return 'unknown'
}

/**
 * Capture uncommitted/unstaged changes from a failed agent's worktree.
 * Runs `git diff HEAD` and stores the result (capped at 50KB) in task.partial_diff.
 * This preserves partial progress when the worktree is cleaned up after failure.
 */
export async function capturePartialDiff(
  taskId: string,
  worktreePath: string,
  repo: ISprintTaskRepository,
  logger: Logger
): Promise<void> {
  try {
    const { stdout } = await execFile('git', ['diff', 'HEAD'], {
      cwd: worktreePath,
      maxBuffer: MAX_PARTIAL_DIFF_SIZE
    })

    if (stdout.trim()) {
      // Cap at 50KB
      const diff = stdout.slice(0, MAX_PARTIAL_DIFF_SIZE)
      const truncated = stdout.length > MAX_PARTIAL_DIFF_SIZE

      repo.updateTask(taskId, {
        partial_diff: truncated ? diff + '\n\n[... diff truncated at 50KB]' : diff
      })

      logger.info(
        `[agent-manager] Captured partial diff for task ${taskId} (${diff.length} bytes${truncated ? ', truncated' : ''})`
      )
    }
  } catch (err) {
    const kind = classifyDiffCaptureError(err)
    const base = `[agent-manager] Failed to capture partial diff for task ${taskId}`
    if (kind === 'git-missing') {
      logger.error(`${base}: git binary not found on PATH — install Xcode CLT or Homebrew (${err})`)
    } else {
      logger.warn(`${base} [${kind}]: ${err}`)
    }
  }
}

/**
 * Spawns an agent with a timeout. Rejects if spawn takes longer than SPAWN_TIMEOUT_MS.
 */
export async function spawnWithTimeout(
  prompt: string,
  cwd: string,
  model: string,
  logger: Logger
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
      SPAWN_TIMEOUT_MS
    )
  })
  return await Promise.race([spawnAgent({ prompt, cwd, model, logger }), timeoutPromise]).finally(
    () => clearTimeout(timer!)
  )
}

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
      logger.warn(
        `[agent-manager] Failed to auto-refresh OAuth token after auth failure: ${getErrorMessage(err)}`
      )
    })
  logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
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

  // Track rate-limit events
  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++
  }
  // Track cost / tokens
  agent.costUsd =
    getNumericField(msg, 'cost_usd') ?? getNumericField(msg, 'total_cost_usd') ?? agent.costUsd
  turnTracker.observe(msg)
  const { tokensIn, tokensOut } = turnTracker.totals()
  agent.tokensIn = tokensIn
  agent.tokensOut = tokensOut
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode

  // Emit events
  const mappedEvents = mapRawMessage(msg)
  for (const event of mappedEvents) {
    emitAgentEvent(agentRunId, event)
  }

  // Detect playground HTML writes
  if (task.playground_enabled) {
    const htmlPath = detectHtmlWrite(msg)
    if (htmlPath) {
      tryEmitPlaygroundEvent(task.id, htmlPath, worktreePath, logger).catch(err => {
        logger.warn(`[run-agent] playground emit failed for task ${task.id}: ${err}`)
      })
    }
  }

  // Capture last assistant text
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
    logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
    const errMsg = getErrorMessage(err)
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

export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const {
    activeAgents,
    defaultModel,
    logger,
    onTaskTerminal,
    repo,
    onSpawnSuccess,
    onSpawnFailure
  } = deps
  const effectiveModel = task.model || defaultModel

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
    return
  }

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
        // Continue with other dependencies
      }
    }
  }

  // Create task scratchpad directory (idempotent — safe to call on retry)
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, task.id)
  mkdirSync(scratchpadDir, { recursive: true })

  // Read prior scratchpad content if present (expected ENOENT on first run)
  let priorScratchpad = ''
  try {
    priorScratchpad = readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    // Expected on first run — no prior scratchpad
  }

  const prompt = buildAgentPrompt({
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

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    // Notify circuit breaker that spawn succeeded — resets failure counter.
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
    logger.error(`[agent-manager] spawnAgent failed for task ${task.id}: ${err}`)
    const errMsg = getErrorMessage(err)
    // Emit agent:error event so the failure is visible in agent console
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
    return
  }

  const agentRunId = randomUUID()

  // Wire up stderr capture — emit as agent:stderr events (non-blocking)
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
  // Persist agent_run_id so LogDrawer can find logs after restart
  try {
    repo.updateTask(task.id, { agent_run_id: agentRunId })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  }
  // Persist agent run to local SQLite for log access and history
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
  // activeCount is derived from activeAgents.size — no manual increment needed

  // Emit agent:started event for console display
  emitAgentEvent(agentRunId, {
    type: 'agent:started',
    model: effectiveModel,
    timestamp: Date.now()
  })

  // Consume messages
  const { exitCode, lastAgentOutput } = await consumeMessages(
    handle,
    agent,
    task,
    worktree.worktreePath,
    agentRunId,
    turnTracker,
    logger
  )

  // Agent exited
  const exitedAt = Date.now()
  const durationMs = exitedAt - agent.startedAt

  // Emit agent:completed event for console display
  emitAgentEvent(agentRunId, {
    type: 'agent:completed',
    exitCode: exitCode ?? 0,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    durationMs,
    timestamp: exitedAt
  })

  // Check if watchdog already cleaned up this agent
  if (!activeAgents.has(task.id)) {
    logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
    // Capture partial diff before cleanup (watchdog timeout may have left partial work)
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

  // NOTE: Do NOT delete from activeAgents until completion handlers finish.
  // Removing early creates a race where orphan recovery re-queues the task
  // while resolveSuccess is still running (the task is still 'active' in the DB).

  // Update agent run record with final state
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

  // Persist cost breakdown (cache tokens) — non-fatal if it fails
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

  // Classify exit (default to exit code 1 if not available, assuming failure)
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

  // Safe to remove from active map now — completion handler has updated the DB
  activeAgents.delete(task.id)

  // Cleanup worktree — but skip for review tasks (worktree preserved for code review)
  const currentTask = repo.getTask(task.id)
  if (currentTask?.status !== 'review') {
    // Before cleanup, capture partial diff for failed tasks (salvage partial progress)
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
