/**
 * Ad-hoc agent spawning — launches interactive Claude sessions via SDK query API
 * with session resumption for multi-turn conversations.
 *
 * Each turn is a separate query() call. The first turn creates a session; subsequent
 * turns use `resume: sessionId` to continue the same conversation. This gives us
 * access to cwd and permissionMode (v1 Options) while supporting multi-turn via
 * session resumption.
 *
 * The v2 Session API (unstable_v2_createSession) doesn't support cwd, so agents
 * spawned with it can't operate in the worktree directory. We use v1 intentionally.
 *
 * `settingSources` is intentionally `[]` here — BDE conventions are injected via
 * `buildAgentPrompt()`, so loading CLAUDE.md through the settings system would
 * double-inject the same context at ~5-10KB extra per turn.
 *
 * **Worktree isolation**: each adhoc agent runs in its own git worktree under a
 * dedicated adhoc base (`~/.bde/worktrees-adhoc/`) so concurrent sessions can't
 * stomp on each other or on the user's main checkout. The worktree is preserved
 * after the session ends so the user can review the diff and optionally promote
 * the work into a sprint task via `agents:promoteToReview`.
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { importAgent, updateAgentMeta, getAgentMeta } from './agent-history'
import { ADHOC_WORKTREE_BASE, getRepoPaths } from './paths'
import { updateAgentRunCost } from './data/agent-queries'
import { execFileAsync } from './lib/async-utils'
import { buildAgentEnvWithAuth, getClaudeCliPath, refreshOAuthTokenFromKeychain } from './env-utils'
import { mapRawMessage, emitAgentEvent } from './agent-event-mapper'
import type { SpawnLocalAgentResult } from '../shared/types'
import { buildAgentPrompt } from './lib/prompt-composer'
import { resolveAgentRuntime, loadBackendSettings } from './agent-manager/backend-selector'
import { spawnOpencode } from './agent-manager/spawn-opencode'
import {
  writeOpencodeWorktreeConfig,
  buildOpencodeFirstTurnPrompt
} from './agent-manager/opencode-worktree-config'
import { startOpencodeSessionMcp } from './agent-manager/opencode-session-mcp'
import { setupWorktree } from './agent-manager/worktree'
import { TurnTracker } from './agent-manager/turn-tracker'
import { createPlannerMcpServer } from './services/planner-mcp-server'
import { createWorktreeIsolationHook } from './agent-manager/worktree-isolation-hook'
import {
  createPlaygroundDetector,
  tryEmitPlaygroundEvent
} from './agent-manager/playground-handler'
import { createEpicGroupService } from './services/epic-group-service'
import { PIPELINE_DISALLOWED_TOOLS } from './agent-manager/turn-budget'
import type { IDashboardRepository } from './data/sprint-task-repository'
import { getErrorMessage } from '../shared/errors'
import { nowIso } from '../shared/time'
import { createLogger } from './logger'
import { getDb } from './db'

const log = createLogger('adhoc-agent')

// ADHOC_WORKTREE_BASE is defined in src/main/paths.ts so the review handlers'
// worktree validator can recognize adhoc worktree paths.

/**
 * Derive a short, branch-safe slug from the user's first task message.
 * Used by `setupWorktree` to name the agent's branch — keeps the branch
 * recognisable instead of being a raw UUID.
 */
function deriveAdhocTitle(task: string): string {
  const firstLine =
    task
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? 'adhoc session'
  // Cap at ~80 chars so the resulting branch slug stays short
  return firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine
}

export interface ImageAttachment {
  data: string // raw base64 (no data: prefix)
  mimeType: string // e.g. 'image/png'
}

/** Wrapper around an SDK session for ad-hoc agent management */
interface AdhocSession {
  send(message: string, images?: ImageAttachment[]): Promise<void>
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
  assistant?: boolean | undefined
  repo: IDashboardRepository
}): Promise<SpawnLocalAgentResult> {
  // Route through agents.backendConfig — the Settings UI is the single source
  // of truth for which model runs each agent type. Assistant and adhoc each
  // get their own entry so they can diverge without code changes.
  const agentType = args.assistant ? 'assistant' : 'adhoc'
  const { model, backend } = resolveAgentRuntime(agentType)

  // Proactively refresh the OAuth token before spawning — the pipeline drain
  // loop handles this for pipeline agents, but adhoc agents bypass that path.
  await refreshOAuthTokenFromKeychain().catch((err) => {
    log.warn(`[adhoc-agent] Failed to refresh OAuth token before spawn: ${getErrorMessage(err)}`)
  })

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
    throw new Error(`Failed to create adhoc worktree: ${getErrorMessage(err)}`)
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

  // In-process MCP server exposing BDE's task/epic CRUD to this session.
  // Without it the agent has no first-class way to create tasks or epics
  // and falls back to shelling out with sqlite3 against ~/.bde/bde.db —
  // which bypasses validation, audit, dependency auto-blocking, and the
  // renderer broadcast. See src/main/services/planner-mcp-server.ts.
  const plannerServer = createPlannerMcpServer({
    epicService: createEpicGroupService(),
    logger: log
  })

  const baseOptions = {
    model,
    cwd: worktreePath,
    env: env as Record<string, string>,
    pathToClaudeCodeExecutable: getClaudeCliPath(),
    // Adhoc agents receive BDE conventions via buildAgentPrompt() — loading
    // CLAUDE.md via 'project' would double-inject conventions and cost ~5-10KB
    // extra per turn. 'user' and 'local' kept for permission settings.
    settingSources: [],
    mcpServers: { bde: plannerServer },
    // Without a canUseTool hook the SDK defaults to prompting the user for
    // every tool call — and adhoc agents have no interactive permission UI,
    // so calls to the in-process BDE MCP server (mcp__bde__tasks.create etc.)
    // stay permanently denied with "you haven't granted it yet". Reusing the
    // pipeline's worktree-isolation hook lets all reads and MCP tools through
    // while still refusing writes that escape the adhoc worktree.
    canUseTool: createWorktreeIsolationHook({
      worktreePath,
      mainRepoPaths: Object.values(getRepoPaths()),
      logger: log
    }),
    disallowedTools: [...PIPELINE_DISALLOWED_TOOLS],
    // Hard cap on spend per interactive session. User-controlled agents can
    // rack up cost across many turns. This is a safety ceiling, not a target.
    maxBudgetUsd: 5.0
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

  // Shared mutable state — declared before both the opencode and SDK paths
  // so both can reference `closed` without a temporal dependency.
  let closed = false
  const startedAt = Date.now()

  // --- Opencode path ---
  // When the configured backend is opencode, each conversational turn spawns
  // `opencode run` rather than calling the Anthropic SDK. The existing
  // mapRawMessage / emitAgentEvent pipeline handles the translated wire messages.
  if (backend === 'opencode') {
    const backendSettings = loadBackendSettings()
    let opencodeSessionId: string | undefined

    // Start a per-session MCP HTTP server backed by the same sprint-service +
    // EpicGroupService as the in-process planner server used by the Claude path.
    // opencode is an external process so it can only reach MCP tools over HTTP;
    // this ephemeral server gives it the same mcp__bde__tasks/epics/meta tools
    // without routing through the persistent external server (port 18792).
    const sessionMcp = await startOpencodeSessionMcp(
      createEpicGroupService(),
      log
    )
    await writeOpencodeWorktreeConfig(worktreePath, sessionMcp.url, sessionMcp.token)

    adhocSessions.set(meta.id, {
      async send(message: string): Promise<void> {
        if (closed) return

        emitAgentEvent(meta.id, {
          type: 'agent:user_message',
          text: message,
          timestamp: Date.now()
        })

        const handle = await spawnOpencode({
          prompt: message,
          cwd: worktreePath,
          model,
          ...(opencodeSessionId !== undefined && { sessionId: opencodeSessionId }),
          executable: backendSettings.opencodeExecutable,
          logger: log
        })

        for await (const rawMsg of handle.messages) {
          if (!opencodeSessionId && handle.sessionId) {
            opencodeSessionId = handle.sessionId
          }
          const events = mapRawMessage(rawMsg, meta.id)
          for (const event of events) {
            emitAgentEvent(meta.id, event)
          }
        }
      },
      close() {
        if (closed) return
        closed = true
        const durationMs = Date.now() - startedAt
        emitAgentEvent(meta.id, {
          type: 'agent:completed',
          exitCode: 0,
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
          timestamp: Date.now()
        })
        updateAgentMeta(meta.id, { status: 'done', finishedAt: nowIso(), exitCode: 0 }).catch(
          (err) => log.warn(`[adhoc] ${meta.id} failed to update meta: ${getErrorMessage(err)}`)
        )
        adhocSessions.delete(meta.id)
        sessionMcp.close().catch(
          (err) => log.warn(`[adhoc] ${meta.id} failed to stop session MCP server: ${getErrorMessage(err)}`)
        )
        log.info(`[adhoc] ${meta.id} opencode session completed after ${Math.round(durationMs / 1000)}s`)
        autoPromoteToReview().catch(
          (err) => log.warn(`[adhoc] ${meta.id} auto-promote failed: ${getErrorMessage(err)}`)
        )
      }
    })

    emitAgentEvent(meta.id, { type: 'agent:started', model, timestamp: Date.now() })
    log.info(`[adhoc] ${meta.id} starting opencode session in ${worktreePath}`)

    // Kick off the first turn with a concise opencode-specific prompt. The full
    // Claude-assembled prompt causes local models to echo context rather than
    // respond. opencode reads CLAUDE.md from --dir automatically (conventions,
    // architecture, key files), so only branch + commit rules need injection.
    adhocSessions
      .get(meta.id)!
      .send(buildOpencodeFirstTurnPrompt(args.task, branch))
      .catch((err) => {
        log.error(`[adhoc] ${meta.id} opencode initial turn failed: ${err}`)
        if (closed) return
        closed = true
        const durationMs = Date.now() - startedAt
        emitAgentEvent(meta.id, {
          type: 'agent:completed',
          exitCode: 1,
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
          timestamp: Date.now()
        })
        updateAgentMeta(meta.id, { status: 'done', finishedAt: nowIso(), exitCode: 1 }).catch(
          (updateErr) => log.warn(`[adhoc] ${meta.id} failed to update meta: ${getErrorMessage(updateErr)}`)
        )
        adhocSessions.delete(meta.id)
      })

    return {
      id: meta.id,
      pid: 0,
      logPath: meta.logPath ?? '',
      interactive: true
    }
  }
  // --- end opencode path, fall through to SDK path ---

  // State shared across SDK turns
  let sessionId: string | null = null
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  const turnTracker = new TurnTracker(meta.id)

  /**
   * Build a multimodal SDKUserMessage when the caller provides images and we
   * already have a session ID.  The generator yields exactly one message then
   * stops — sdk.query() expects an AsyncIterable<SDKUserMessage> for this path.
   */
  async function* makeMultimodalPrompt(
    message: string,
    images: ImageAttachment[],
    sid: string
  ): AsyncGenerator<import('@anthropic-ai/claude-agent-sdk').SDKUserMessage> {
    type ValidMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: ValidMimeType; data: string } }
    > = []
    if (message) content.push({ type: 'text', text: message })
    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType as ValidMimeType,
          data: img.data
        }
      })
    }
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: sid
    } as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage
  }

  /**
   * Pairs tool_use with tool_result blocks across the SDK stream so the
   * session-scoped detector only fires when a Write has actually completed.
   */
  const playgroundDetector = createPlaygroundDetector()

  /**
   * Inspect a raw SDK message for a completed Write to a playground content
   * type (html / svg / md / json) and, if so, sanitize-and-emit the
   * agent:playground event so the renderer shows a PlaygroundCard.
   *
   * Unlike pipeline agents, adhoc sessions are user-driven — the user may ask
   * the agent to render files outside the worktree (e.g. /tmp scratch files),
   * so we pass `allowAnyPath: true`. DOMPurify still runs inside the emitter.
   */
  function maybeEmitPlaygroundFromMessage(raw: unknown): void {
    const write = playgroundDetector.onMessage(raw)
    if (!write) return

    void tryEmitPlaygroundEvent({
      taskId: meta.id,
      filePath: write.path,
      worktreePath,
      logger: log,
      contentType: write.contentType,
      allowAnyPath: true
    }).catch((err) => {
      log.warn(`[adhoc] ${meta.id} playground emit failed: ${getErrorMessage(err)}`)
    })
  }

  /**
   * Run one conversation turn: create a query (first turn) or resume (subsequent turns).
   * When images are present and a session already exists, we send a proper multimodal
   * SDKUserMessage with base64 image blocks so Claude actually sees the screenshot.
   */
  async function runTurn(message: string, images?: ImageAttachment[]): Promise<void> {
    if (closed) return

    const options = sessionId ? { ...baseOptions, resume: sessionId } : baseOptions

    // Use multimodal message when we have images + an active session ID.
    // For the first turn (no session yet), fall back to plain text — the
    // user spawns an agent with text, not by pasting an image.
    const prompt =
      images && images.length > 0 && sessionId
        ? makeMultimodalPrompt(message, images, sessionId)
        : message

    const queryHandle = sdk.query({ prompt, options })

    try {
      for await (const raw of queryHandle) {
        const events = mapRawMessage(raw, meta.id)
        for (const event of events) {
          emitAgentEvent(meta.id, event)
        }

        maybeEmitPlaygroundFromMessage(raw)

        // Extract session ID from system init message
        if (typeof raw === 'object' && raw !== null) {
          const rawMessage = raw as Record<string, unknown>
          if (
            rawMessage.type === 'system' &&
            rawMessage.subtype === 'init' &&
            typeof rawMessage.session_id === 'string'
          ) {
            sessionId = rawMessage.session_id
            log.info(`[adhoc] ${meta.id} session ID: ${sessionId}`)
          }
          // Track cost/token fields
          if (typeof rawMessage.cost_usd === 'number') costUsd = rawMessage.cost_usd
          if (typeof rawMessage.total_cost_usd === 'number') costUsd = rawMessage.total_cost_usd
          turnTracker.processMessage(rawMessage)
          ;({ tokensIn, tokensOut } = turnTracker.totals())
        }
      }
      log.info(`[adhoc] ${meta.id} turn complete, session alive`)
    } catch (err) {
      log.error(`[adhoc] ${meta.id} turn error: ${getErrorMessage(err)}`)
      emitAgentEvent(meta.id, {
        type: 'agent:error',
        message: getErrorMessage(err),
        timestamp: Date.now()
      })
    }
  }

  /**
   * Complete the session — emit completed event, persist cost, and auto-promote
   * to Code Review if the agent committed work. Worktree is preserved for review.
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
      finishedAt: nowIso(),
      exitCode: 0
    }).catch((err) => {
      log.warn(`[adhoc-agent] Failed to update agent meta on completion: ${getErrorMessage(err)}`)
    })

    try {
      const totals = turnTracker.totals()
      updateAgentRunCost(getDb(), meta.id, {
        costUsd,
        tokensIn: totals.tokensIn,
        tokensOut: totals.tokensOut,
        cacheRead: totals.cacheTokensRead,
        cacheCreate: totals.cacheTokensCreated,
        durationMs,
        numTurns: totals.turnCount
      })
    } catch {
      // Non-fatal — best-effort cost persistence
    }

    adhocSessions.delete(meta.id)
    log.info(`[adhoc] ${meta.id} session completed after ${Math.round(durationMs / 1000)}s`)

    // Auto-promote to Code Review if the agent committed work
    autoPromoteToReview().catch((err) => {
      log.warn(`[adhoc] ${meta.id} auto-promote failed: ${getErrorMessage(err)}`)
    })
  }

  /**
   * Check if the adhoc worktree has commits beyond main and, if so,
   * automatically create a sprint task in `review` status so the work
   * appears in Code Review Station without manual promotion.
   */
  async function autoPromoteToReview(): Promise<void> {
    // Skip if the user already promoted mid-session via the UI button
    const currentMeta = await getAgentMeta(meta.id)
    if (currentMeta?.sprintTaskId) {
      log.info(`[adhoc] ${meta.id} already promoted — skipping auto-promote`)
      return
    }

    const env = buildAgentEnvWithAuth()
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--count', `origin/main..${branch}`],
        { cwd: worktreePath, env: env as Record<string, string> }
      )
      const commitCount = parseInt(stdout.trim(), 10)
      if (!Number.isFinite(commitCount) || commitCount === 0) {
        log.info(`[adhoc] ${meta.id} no commits beyond main — skipping auto-promote`)
        return
      }
    } catch (err) {
      log.warn(`[adhoc] ${meta.id} commit count check failed: ${getErrorMessage(err)}`)
      // Non-fatal — proceed anyway; Code Review handles empty diffs gracefully
    }

    const firstLine =
      meta.task
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? 'Adhoc agent session'
    const title = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine

    const task = await args.repo.createReviewTaskFromAdhoc({
      title,
      repo: meta.repo,
      spec: meta.task,
      worktreePath,
      branch
    })

    if (!task) {
      log.warn(`[adhoc] ${meta.id} auto-promote: createReviewTaskFromAdhoc returned null`)
      return
    }

    // Link the agent to the sprint task so the manual promote button hides
    await updateAgentMeta(meta.id, { sprintTaskId: task.id })
    log.info(`[adhoc] ${meta.id} auto-promoted to review task ${task.id}`)
  }

  // Track for steering / kill
  adhocSessions.set(meta.id, {
    async send(message: string, images?: ImageAttachment[]) {
      if (closed) return

      // Emit user message event so it appears in the console UI
      emitAgentEvent(meta.id, {
        type: 'agent:user_message',
        text: message,
        timestamp: Date.now()
      })

      // Run the next turn with session resumption (multimodal when images present)
      await runTurn(message, images)
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
