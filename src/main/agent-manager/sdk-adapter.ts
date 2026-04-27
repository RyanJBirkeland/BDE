/**
 * SDK adapter — thin facade over spawn-sdk, spawn-cli, and sdk-message-protocol.
 *
 * Public API (`spawnAgent`, `spawnWithTimeout`) is unchanged.
 * Protocol helpers re-exported for callers that import them from here.
 */
import type { AgentHandle, SpawnStrategy } from './types'
import type { Logger } from '../logger'
import type { AgentType } from '../agent-system/personality/types'
import { dirname, resolve as resolvePath } from 'node:path'
import { realpathSync } from 'node:fs'
import { DEFAULT_CONFIG, SPAWN_TIMEOUT_MS } from './types'
import { buildAgentEnv, getOAuthToken, getClaudeCliPath } from '../env-utils'
import { resolveNodeExecutable } from './resolve-node'
import { spawnViaSdk, type PipelineSpawnTuning } from './spawn-sdk'
import { spawnViaCli } from './spawn-cli'
import { loadBackendSettings, resolveAgentRuntime } from './backend-selector'
import { spawnLocalAgent } from './local-adapter'
import { spawnOpencode } from './spawn-opencode'
import { startOpencodeSessionMcp, type OpencodeSessionMcpHandle } from './opencode-session-mcp'
import {
  writeOpencodeWorktreeConfig,
  buildOpencodeFirstTurnPrompt
} from './opencode-worktree-config'
import { createEpicGroupService } from '../services/epic-group-service'

/**
 * Pipeline agents must only spawn with a `cwd` inside a BDE-managed worktree
 * base. Any other cwd — the main repo, /tmp, or the user's home — means the
 * agent would write directly to a location that should be isolated from the
 * main checkout. This is the last-chance check before the SDK / CLI actually
 * starts the process.
 *
 * The allowlist is derived from the caller's `AgentManagerConfig.worktreeBase`
 * (threaded through spawnAgent's options) so users who override the worktree
 * base in Settings are not rejected by a module-scope default snapshot.
 *
 * Defense-in-depth: both sides of the prefix compare are normalized via
 * `realpathSync` so a symlink anywhere along either path cannot smuggle a
 * physical location outside the base into a string that textually starts with
 * the base. A `realpathSync` failure (e.g. ENOENT for a not-yet-existent cwd)
 * fails closed — the spawn is refused.
 */
function isInsideAllowedWorktreeBase(cwd: string, worktreeBase: string, logger?: Logger): boolean {
  const physicalCwd = resolvePhysicalPath(cwd, logger)
  if (physicalCwd === null) return false
  const physicalBase = resolvePhysicalPath(worktreeBase, logger)
  if (physicalBase === null) return false
  return physicalCwd.startsWith(physicalBase + '/')
}

/**
 * Returns the canonical filesystem path for `path` (symlinks resolved), or
 * `null` if the path cannot be resolved. Logs the failure context so a
 * misconfigured worktree base is diagnosable.
 */
function resolvePhysicalPath(path: string, logger?: Logger): string | null {
  const lexicalPath = resolvePath(path)
  try {
    return realpathSync(lexicalPath)
  } catch (err) {
    ;(logger ?? console).warn(
      `[agent-manager] realpath failed for "${lexicalPath}": ${(err as Error).message}`
    )
    return null
  }
}

function assertCwdIsInsideWorktreeBase(cwd: string, worktreeBase: string, logger?: Logger): void {
  if (!isInsideAllowedWorktreeBase(cwd, worktreeBase, logger)) {
    throw new Error(
      `Refusing to spawn agent: cwd "${cwd}" is not inside the configured worktree base (${worktreeBase}). ` +
        `Pipeline agents must only run inside isolated worktrees.`
    )
  }
}

/**
 * Resolves the spawn strategy by attempting to import the SDK.
 * Returns `{ type: 'sdk' }` on success, `{ type: 'cli'; claudePath }` on failure.
 */
async function resolveSpawnStrategy(): Promise<SpawnStrategy> {
  try {
    await import('@anthropic-ai/claude-agent-sdk')
    return { type: 'sdk' }
  } catch {
    return { type: 'cli', claudePath: getClaudeCliPath() }
  }
}

// Re-export SpawnStrategy so callers can reference the type without importing types.ts directly
export type { SpawnStrategy } from './types'

// Re-export protocol helpers so existing imports don't break
export type { SDKWireMessage } from './sdk-message-protocol'
export {
  asSDKMessage,
  getNumericField,
  getSessionId,
  isRateLimitMessage
} from './sdk-message-protocol'

// Re-export CLI constants so existing imports don't break
export { AGENT_PROCESS_MAX_OLD_SPACE_MB, withMaxOldSpaceOption } from './spawn-cli'

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number | undefined
  logger?: Logger | undefined
  /**
   * Which agent type is being spawned. Routes through the backend-selector to
   * pick Claude vs. the local `rbt-coding-agent` backend based on settings.
   * Defaults to `'pipeline'` because today only the Pipeline path flows
   * through this function — other agent types (adhoc, copilot, synthesizer,
   * assistant, reviewer) have their own dedicated spawn paths.
   */
  agentType?: AgentType | undefined
  /**
   * Pipeline-agent-only overrides for SDK options. Adhoc, assistant, copilot,
   * and synthesizer agents use their own spawn paths and never set this.
   */
  pipelineTuning?: PipelineSpawnTuning | undefined
  /**
   * Configured worktree base for the pipeline cwd allowlist check. Required
   * when `pipelineTuning` is set; ignored otherwise. Default retained for
   * call sites that don't have access to live config (smoke tests, etc.).
   */
  worktreeBase?: string | undefined
  sessionId?: string | undefined
  /**
   * Branch name for opencode agents. When provided, the prompt is replaced
   * with a lightweight branch-prefixed version — opencode already reads
   * CLAUDE.md from --dir, so the full assembled prompt is not needed.
   */
  branch?: string | undefined
  /** Task ID forwarded to spawn log for forensic timeline reconstruction. */
  taskId?: string | undefined
  /** Drain-tick correlation ID for cross-event log joins. */
  tickId?: string | undefined
}): Promise<AgentHandle> {
  // Worktree-base cwd assertion applies only to pipeline agents — adhoc,
  // assistant, copilot, and synthesizer agents run in the user's repo or
  // freeform directories and are gated elsewhere. Pipeline agents are the
  // ones that can leak edits into the main repo if misrouted.
  if (opts.pipelineTuning) {
    const base = opts.worktreeBase ?? DEFAULT_CONFIG.worktreeBase
    assertCwdIsInsideWorktreeBase(opts.cwd, base, opts.logger)
  }

  const agentType: AgentType = opts.agentType ?? 'pipeline'
  const settings = loadBackendSettings()
  const resolved = resolveAgentRuntime(agentType, settings)

  if (resolved.backend === 'local') {
    try {
      const handle = await spawnLocalAgent({
        prompt: opts.prompt,
        cwd: opts.cwd,
        model: resolved.model,
        endpoint: settings.localEndpoint,
        logger: opts.logger
      })
      return annotateHandle(handle, 'local', resolved.model)
    } catch (err) {
      opts.logger?.warn(
        `[agent-manager] local backend for ${agentType} failed; falling back to Claude: ${(err as Error).message}`
      )
      // Fall through to Claude path below.
    }
  }

  if (resolved.backend === 'opencode') {
    return spawnOpencodeWithMcp(opts, resolved.model, settings.opencodeExecutable)
  }

  const modelForClaude = resolved.backend === 'claude' ? resolved.model : opts.model
  const claudeHandle = await spawnClaudeAgent({ ...opts, model: modelForClaude })
  return annotateHandle(claudeHandle, 'claude', modelForClaude)
}

async function spawnOpencodeWithMcp(
  opts: {
    prompt: string
    cwd: string
    model: string
    logger?: Logger | undefined
    sessionId?: string | undefined
    branch?: string | undefined
  },
  resolvedModel: string,
  executable?: string
): Promise<AgentHandle> {
  const logger = opts.logger ?? nullLogger()
  const sessionMcp = await startOpencodeSessionMcp(createEpicGroupService(), logger)
  await writeOpencodeWorktreeConfig(opts.cwd, sessionMcp.url, sessionMcp.token)

  const prompt =
    opts.branch != null ? buildOpencodeFirstTurnPrompt(opts.prompt, opts.branch) : opts.prompt

  let handle: AgentHandle
  try {
    handle = await spawnOpencode({
      prompt,
      cwd: opts.cwd,
      model: resolvedModel,
      ...(opts.sessionId && { sessionId: opts.sessionId }),
      ...(executable && { executable }),
      ...(opts.logger && { logger: opts.logger })
    })
  } catch (err) {
    sessionMcp.close().catch((closeErr: unknown) => {
      logger.warn(
        `[agent-manager] Failed to close opencode session MCP server after spawn error: ${closeErr}`
      )
    })
    throw err
  }

  return {
    ...handle,
    messages: withMcpCleanup(handle.messages, sessionMcp, opts.logger)
  }
}

async function* withMcpCleanup(
  messages: AsyncIterable<unknown>,
  sessionMcp: OpencodeSessionMcpHandle,
  logger?: Logger
): AsyncGenerator<unknown> {
  try {
    yield* messages
  } finally {
    sessionMcp.close().catch((err: unknown) => {
      logger?.warn(`[agent-manager] Failed to close opencode session MCP server: ${err}`)
    })
  }
}

function nullLogger(): Logger {
  const noop = (): void => {}
  return { info: noop, warn: noop, error: noop, debug: noop, event: noop }
}

function annotateHandle(
  handle: AgentHandle,
  backend: 'claude' | 'local' | 'opencode',
  resolvedModel: string
): AgentHandle {
  return Object.assign(handle, { backend, resolvedModel })
}

async function spawnClaudeAgent(opts: {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number | undefined
  logger?: Logger | undefined
  pipelineTuning?: PipelineSpawnTuning | undefined
  taskId?: string | undefined
  agentType?: string | undefined
  tickId?: string | undefined
}): Promise<AgentHandle> {
  const env = { ...buildAgentEnv() }
  prependResolvedNodeDirToPath(env, opts.logger)

  const token = getOAuthToken()
  const strategy = await resolveSpawnStrategy()

  if (strategy.type === 'sdk') {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return spawnViaSdk(sdk, opts, env, token, strategy, opts.logger)
  }

  return spawnViaCli(
    { prompt: opts.prompt, cwd: opts.cwd, model: opts.model, maxBudgetUsd: opts.maxBudgetUsd },
    env,
    token,
    opts.logger
  )
}

/**
 * Spawns an agent with a timeout. Rejects if spawn takes longer than SPAWN_TIMEOUT_MS.
 */
export async function spawnWithTimeout(
  prompt: string,
  cwd: string,
  model: string,
  logger: Logger,
  maxBudgetUsd?: number,
  pipelineTuning?: PipelineSpawnTuning,
  worktreeBase?: string,
  branch?: string,
  tickId?: string
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
      SPAWN_TIMEOUT_MS
    )
  })
  return await Promise.race([
    spawnAgent({ prompt, cwd, model, logger, maxBudgetUsd, pipelineTuning, worktreeBase, branch, tickId }),
    timeoutPromise
  ]).finally(() => clearTimeout(timer!))
}

/**
 * Ensures the SDK's internal `spawn('node', …)` call can find a usable node.
 *
 * Packaged macOS `.app` bundles launched from Finder/Spotlight inherit only
 * `/etc/paths`, which omits fnm/nvm install locations. If the user's node is
 * not already on PATH, we prepend the directory holding the resolved node
 * binary so the SDK's shebang lookup succeeds.
 */
function prependResolvedNodeDirToPath(
  env: Record<string, string | undefined>,
  logger: Logger | undefined
): void {
  const resolvedNode = resolveNodeExecutable()
  if (!resolvedNode) {
    ;(logger ?? console).warn(
      '[agent-manager] No node binary found at known locations — falling back to PATH lookup'
    )
    return
  }
  const nodeDir = dirname(resolvedNode)
  const existingPath = env.PATH ?? ''
  if (existingPath.split(':').includes(nodeDir)) return
  env.PATH = existingPath ? `${nodeDir}:${existingPath}` : nodeDir
}
