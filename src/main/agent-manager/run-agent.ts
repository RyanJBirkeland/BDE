import type { ActiveAgent, AgentHandle, Logger } from './types'
import { SPAWN_TIMEOUT_MS, LAST_OUTPUT_MAX_LENGTH } from './types'
import { classifyExit } from './fast-fail'
import { cleanupWorktree } from './worktree'
import { spawnAgent } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getGhRepo } from '../paths'
import { createAgentRecord, updateAgentMeta } from '../agent-history'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'
import { broadcast } from '../broadcast'
import { mapRawMessage, emitAgentEvent } from '../agent-event-mapper'
import type { AgentEvent } from '../../shared/types'
import { buildAgentPrompt } from './prompt-composer'

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
  playground_enabled?: boolean
  max_runtime_ms?: number | null
}

export interface RunAgentDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  repo: ISprintTaskRepository
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024 // 5MB

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

/**
 * Detects if a message is a tool_result for a Write tool that created an .html file.
 * Returns the file path if detected, null otherwise.
 */
export function detectHtmlWrite(msg: unknown): string | null {
  if (typeof msg !== 'object' || msg === null) return null
  const m = msg as Record<string, unknown>

  // Check if this is a tool_result or result message
  if (m.type !== 'tool_result' && m.type !== 'result') return null

  // Check if the tool is Write (case-insensitive)
  const toolName = (m.tool_name as string) ?? (m.name as string) ?? ''
  if (toolName.toLowerCase() !== 'write') return null

  // Extract file path from the tool input or output
  // The Write tool typically has input with { file_path: "..." }
  const input = m.input as Record<string, unknown> | undefined
  const filePath = input?.file_path as string | undefined

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

    // Read file content
    const html = await readFile(absolutePath, 'utf-8')
    const filename = basename(absolutePath)

    // Emit playground event
    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html,
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

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { activeAgents, defaultModel, logger, onTaskTerminal, repo } = deps

  const taskContent = (task.prompt || task.spec || task.title || '').trim()
  if (!taskContent) {
    logger.error(`[agent-manager] Task ${task.id} has no prompt/spec/title — marking error`)
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: new Date().toISOString(),
      notes: 'Agent failed to start: task has no prompt, spec, or title. To fix: edit the task and provide a prompt or spec describing what the agent should do.',
      claimed_by: null
    })
    await onTaskTerminal(task.id, 'error')
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
    return
  }

  const prompt = buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled
  })

  let handle: AgentHandle
  try {
    handle = await Promise.race([
      spawnAgent({
        prompt,
        cwd: worktree.worktreePath,
        model: defaultModel,
        logger
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
          SPAWN_TIMEOUT_MS
        )
      )
    ])
  } catch (err) {
    logger.error(`[agent-manager] spawnAgent failed for task ${task.id}: ${err}`)
    try {
      repo.updateTask(task.id, {
        status: 'error',
        completed_at: new Date().toISOString(),
        notes: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        claimed_by: null
      })
    } catch (updateErr) {
      logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`)
    }
    await onTaskTerminal(task.id, 'error')
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
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
    model: defaultModel,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: task.max_runtime_ms ?? null
  }
  activeAgents.set(task.id, agent)
  let lastAgentOutput = ''
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
    sprintTaskId: task.id
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`)
  )
  // activeCount is derived from activeAgents.size — no manual increment needed

  // Emit agent:started event for console display
  emitAgentEvent(agentRunId, { type: 'agent:started', model: defaultModel, timestamp: Date.now() })

  // Consume messages
  let exitCode: number | undefined
  try {
    for await (const msg of handle.messages) {
      agent.lastOutputAt = Date.now()

      // Track rate-limit events
      if (isRateLimitMessage(msg)) {
        agent.rateLimitCount++
      }
      // Track cost / tokens if present (check both top-level and nested fields)
      agent.costUsd =
        getNumericField(msg, 'cost_usd') ?? getNumericField(msg, 'total_cost_usd') ?? agent.costUsd
      agent.tokensIn = getNumericField(msg, 'tokens_in') ?? agent.tokensIn
      agent.tokensOut = getNumericField(msg, 'tokens_out') ?? agent.tokensOut
      // Also check nested usage object (SDK sometimes nests token counts)
      if (typeof msg === 'object' && msg !== null) {
        const m = msg as Record<string, unknown>
        if (typeof m.usage === 'object' && m.usage !== null) {
          const u = m.usage as Record<string, unknown>
          if (typeof u.input_tokens === 'number') agent.tokensIn = u.input_tokens
          if (typeof u.output_tokens === 'number') agent.tokensOut = u.output_tokens
        }
      }
      // Track exit code if present (typically in last message)
      exitCode = getNumericField(msg, 'exit_code') ?? exitCode

      // Map SDK message → AgentEvents and emit for console display + persistence
      const mappedEvents = mapRawMessage(msg)
      for (const event of mappedEvents) {
        emitAgentEvent(agentRunId, event)
      }

      // Detect playground HTML writes (when enabled)
      if (task.playground_enabled) {
        const htmlPath = detectHtmlWrite(msg)
        if (htmlPath) {
          // Fire-and-forget — don't block message loop
          tryEmitPlaygroundEvent(task.id, htmlPath, worktree.worktreePath, logger).catch(() => {
            // Already logged inside tryEmitPlaygroundEvent
          })
        }
      }
      // Capture last assistant text for diagnostics
      if (typeof msg === 'object' && msg !== null) {
        const m = msg as Record<string, unknown>
        if (m.type === 'assistant' && typeof m.text === 'string') {
          lastAgentOutput = (m.text as string).slice(-LAST_OUTPUT_MAX_LENGTH)
        }
      }
    }
  } catch (err) {
    logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
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
      const { invalidateOAuthToken, refreshOAuthTokenFromKeychain } = await import('../env-utils')
      invalidateOAuthToken()
      // Try to auto-refresh so next agent doesn't fail too
      refreshOAuthTokenFromKeychain()
        .then((ok) => {
          if (ok)
            logger.info(
              '[agent-manager] OAuth token auto-refreshed from Keychain after auth failure'
            )
        })
        .catch(() => {})
      logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
    }
  }

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
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
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

  // Classify exit (default to exit code 1 if not available, assuming failure)
  const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
  const now = new Date().toISOString()

  if (ffResult === 'fast-fail-exhausted') {
    try {
      repo.updateTask(task.id, {
        status: 'error',
        completed_at: now,
        notes: 'Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to \'queued\' and clear claimed_by.',
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

  // Cleanup worktree (fire-and-forget)
  cleanupWorktree({
    repoPath,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  })

  logger.info(`[agent-manager] Agent completed for task ${task.id} (${ffResult})`)
}
