/**
 * Ad-hoc agent spawning — launches interactive Claude sessions via SDK query API
 * with session resumption for multi-turn conversations.
 *
 * Each turn is a separate query() call. The first turn creates a session; subsequent
 * turns use `resume: sessionId` to continue the same conversation. This gives us
 * access to cwd, settingSources, and permissionMode (v1 Options) while supporting
 * multi-turn via session resumption.
 *
 * The v2 Session API (unstable_v2_createSession) doesn't support cwd or
 * settingSources, so agents spawned with it can't find CLAUDE.md or project context.
 *
 * **Worktree isolation**: each adhoc agent runs in its own git worktree under a
 * dedicated adhoc base (`~/worktrees/bde-adhoc/`) so concurrent sessions can't
 * stomp on each other or on the user's main checkout. The worktree is preserved
 * after the session ends so the user can review the diff and optionally promote
 * the work into a sprint task via `agents:promoteToReview`.
 */
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { importAgent, updateAgentMeta } from './agent-history'
import { buildAgentEnvWithAuth, getClaudeCliPath } from './env-utils'
import { mapRawMessage, emitAgentEvent } from './agent-event-mapper'
import type { SpawnLocalAgentResult } from '../shared/types'
import { buildAgentPrompt } from './agent-manager/prompt-composer'
import { setupWorktree } from './agent-manager/worktree'
import { createLogger } from './logger'

const log = createLogger('adhoc-agent')

/**
 * Dedicated worktree base for adhoc agents. Kept separate from the pipeline
 * worktree base so the pipeline pruner (which only knows about sprint task IDs)
 * never accidentally deletes a live adhoc worktree.
 */
const ADHOC_WORKTREE_BASE = join(homedir(), 'worktrees', 'bde-adhoc')

/**
 * Derive a short, branch-safe slug from the user's first task message.
 * Used by `setupWorktree` to name the agent's branch — keeps the branch
 * recognisable instead of being a raw UUID.
 */
function deriveAdhocTitle(task: string): string {
  const firstLine = task.split('\n').find((l) => l.trim())?.trim() ?? 'adhoc session'
  // Cap at ~80 chars so the resulting branch slug stays short
  return firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine
}

/** Wrapper around an SDK session for ad-hoc agent management */
interface AdhocSession {
  send(message: string): Promise<void>
  close(): void
}

/** Active ad-hoc sessions, keyed by agent run ID */
const adhocSessions = new Map<string, AdhocSession>()

export function getAdhocHandle(agentId: string): AdhocSession | undefined {
  return adhocSessions.get(agentId)
}

export async function spawnAdhocAgent(args: {
  task: string
  repoPath: string
  model?: string
  assistant?: boolean
}): Promise<SpawnLocalAgentResult> {
  const model = args.model || 'claude-sonnet-4-5'
  const env = buildAgentEnvWithAuth()

  const sdk = await import('@anthropic-ai/claude-agent-sdk')

  // Allocate the agent ID up front so the worktree directory name matches
  // the agent_runs row — keeps debugging straightforward.
  const agentId = randomUUID()

  // Create an isolated worktree for this session. We use a dedicated base
  // (ADHOC_WORKTREE_BASE) so the pipeline pruner can't see these and
  // accidentally remove them. The worktree stays alive after the session
  // ends so the user can review the diff or promote it to a sprint task.
  let worktreePath: string
  let branch: string
  try {
    const worktree = await setupWorktree({
      repoPath: args.repoPath,
      worktreeBase: ADHOC_WORKTREE_BASE,
      taskId: agentId,
      title: deriveAdhocTitle(args.task),
      logger: log
    })
    worktreePath = worktree.worktreePath
    branch = worktree.branch
    log.info(`[adhoc] ${agentId} worktree ready at ${worktreePath} on branch ${branch}`)
  } catch (err) {
    log.error(`[adhoc] ${agentId} failed to create worktree: ${err}`)
    throw new Error(
      `Failed to create adhoc worktree: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Build composed prompt with preamble. Pass the branch so the agent knows
  // which branch it owns — the prompt composer wraps this in the standard
  // branch appendix.
  const repoName = basename(args.repoPath).toLowerCase()
  const prompt = buildAgentPrompt({
    agentType: args.assistant ? 'assistant' : 'adhoc',
    taskContent: args.task,
    branch,
    repoName
  })

  // Shared options for all turns (v1 Options — has cwd + settingSources)
  // Uses settingSources to inherit user's permissions from ~/.claude/settings.json
  // instead of bypassPermissions — agents respect the user's configured guardrails
  const baseOptions = {
    model,
    cwd: worktreePath,
    env: env as Record<string, string>,
    pathToClaudeCodeExecutable: getClaudeCliPath(),
    settingSources: ['user' as const, 'project' as const, 'local' as const]
  }

  // Record in agent_runs (with worktree path + branch persisted so the
  // Promote handler can find them later)
  const repo = basename(args.repoPath).toLowerCase()
  const meta = await importAgent(
    {
      id: agentId,
      pid: null,
      bin: 'claude',
      model,
      repo,
      repoPath: args.repoPath,
      task: args.task,
      status: 'running',
      source: 'adhoc',
      worktreePath,
      branch
    },
    ''
  )

  // State shared across turns
  let sessionId: string | null = null
  let closed = false
  const startedAt = Date.now()
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0

  /**
   * Run one conversation turn: create a query (first turn) or resume (subsequent turns).
   * Consumes all messages until the iterator completes (result message).
   */
  async function runTurn(message: string): Promise<void> {
    if (closed) return

    const options = sessionId ? { ...baseOptions, resume: sessionId } : baseOptions

    const queryHandle = sdk.query({ prompt: message, options })

    try {
      for await (const raw of queryHandle) {
        const events = mapRawMessage(raw)
        for (const event of events) {
          emitAgentEvent(meta.id, event)
        }

        // Extract session ID from system init message
        if (typeof raw === 'object' && raw !== null) {
          const r = raw as Record<string, unknown>
          if (r.type === 'system' && r.subtype === 'init' && typeof r.session_id === 'string') {
            sessionId = r.session_id
            log.info(`[adhoc] ${meta.id} session ID: ${sessionId}`)
          }
          // Track cost/token fields
          if (typeof r.cost_usd === 'number') costUsd = r.cost_usd
          if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd
          if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
          if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
          if (typeof r.usage === 'object' && r.usage !== null) {
            const u = r.usage as Record<string, unknown>
            if (typeof u.input_tokens === 'number') tokensIn = u.input_tokens
            if (typeof u.output_tokens === 'number') tokensOut = u.output_tokens
          }
        }
      }
      log.info(`[adhoc] ${meta.id} turn complete, session alive`)
    } catch (err) {
      log.error(
        `[adhoc] ${meta.id} turn error: ${err instanceof Error ? err.message : String(err)}`
      )
      emitAgentEvent(meta.id, {
        type: 'agent:error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      })
    }
  }

  /**
   * Complete the session — emit completed event and clean up.
   * Note: the worktree is intentionally preserved so the user can review
   * the diff or promote it via `agents:promoteToReview`. Cleanup happens
   * later when the agent_runs row is pruned.
   */
  function completeSession(): void {
    if (closed) return
    closed = true

    const durationMs = Date.now() - startedAt
    emitAgentEvent(meta.id, {
      type: 'agent:completed',
      exitCode: 0,
      costUsd,
      tokensIn,
      tokensOut,
      durationMs,
      timestamp: Date.now()
    })

    updateAgentMeta(meta.id, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      exitCode: 0
    }).catch(() => {})

    adhocSessions.delete(meta.id)
    log.info(`[adhoc] ${meta.id} session completed after ${Math.round(durationMs / 1000)}s`)
  }

  // Track for steering / kill
  adhocSessions.set(meta.id, {
    async send(message: string) {
      if (closed) return

      // Emit user message event so it appears in the console UI
      emitAgentEvent(meta.id, {
        type: 'agent:user_message',
        text: message,
        timestamp: Date.now()
      })

      // Run the next turn with session resumption
      await runTurn(message)
    },
    close() {
      completeSession()
    }
  })

  // Start first turn
  emitAgentEvent(meta.id, { type: 'agent:started', model, timestamp: Date.now() })
  log.info(`[adhoc] ${meta.id} starting session in ${worktreePath}`)

  runTurn(prompt).catch((err) => {
    log.error(`[adhoc] ${meta.id} initial turn failed: ${err}`)
    completeSession()
  })

  return {
    id: meta.id,
    pid: 0,
    logPath: meta.logPath ?? '',
    interactive: true
  }
}
