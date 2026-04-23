/**
 * SDK adapter — thin facade over spawn-sdk, spawn-cli, and sdk-message-protocol.
 *
 * Public API (`spawnAgent`, `spawnWithTimeout`) is unchanged.
 * Protocol helpers re-exported for callers that import them from here.
 */
import type { AgentHandle } from './types'
import type { Logger } from '../logger'
import type { AgentType } from '../agent-system/personality/types'
import { dirname, resolve as resolvePath } from 'node:path'
import { DEFAULT_CONFIG, SPAWN_TIMEOUT_MS } from './types'
import { buildAgentEnv, getOAuthToken } from '../env-utils'
import { resolveNodeExecutable } from './resolve-node'
import { spawnViaSdk, type PipelineSpawnTuning } from './spawn-sdk'
import { spawnViaCli } from './spawn-cli'
import { loadBackendSettings, resolveAgentRuntime } from './backend-selector'
import { spawnLocalAgent } from './local-adapter'
import { spawnOpencode } from './spawn-opencode'

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
 */
function isInsideAllowedWorktreeBase(cwd: string, worktreeBase: string): boolean {
  const resolved = resolvePath(cwd)
  return resolved.startsWith(resolvePath(worktreeBase) + '/')
}

function assertCwdIsInsideWorktreeBase(cwd: string, worktreeBase: string): void {
  if (!isInsideAllowedWorktreeBase(cwd, worktreeBase)) {
    throw new Error(
      `Refusing to spawn agent: cwd "${cwd}" is not inside the configured worktree base (${worktreeBase}). ` +
        `Pipeline agents must only run inside isolated worktrees.`
    )
  }
}

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
}): Promise<AgentHandle> {
  // Worktree-base cwd assertion applies only to pipeline agents — adhoc,
  // assistant, copilot, and synthesizer agents run in the user's repo or
  // freeform directories and are gated elsewhere. Pipeline agents are the
  // ones that can leak edits into the main repo if misrouted.
  if (opts.pipelineTuning) {
    const base = opts.worktreeBase ?? DEFAULT_CONFIG.worktreeBase
    assertCwdIsInsideWorktreeBase(opts.cwd, base)
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
    const handle = await spawnOpencode({
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: resolved.model,
      ...(opts.sessionId && { sessionId: opts.sessionId }),
      executable: settings.opencodeExecutable,
      ...(opts.logger && { logger: opts.logger })
    })
    return annotateHandle(handle, 'opencode', resolved.model)
  }

  const modelForClaude = resolved.backend === 'claude' ? resolved.model : opts.model
  const claudeHandle = await spawnClaudeAgent({ ...opts, model: modelForClaude })
  return annotateHandle(claudeHandle, 'claude', modelForClaude)
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
}): Promise<AgentHandle> {
  const env = { ...buildAgentEnv() }
  prependResolvedNodeDirToPath(env, opts.logger)

  // Get OAuth token for SDK auth (not passed via env)
  const token = getOAuthToken()

  // Try SDK first, fall back to CLI
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return spawnViaSdk(sdk, opts, env, token, opts.logger)
  } catch {
    // SDK not available — use CLI fallback
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
  worktreeBase?: string
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
      SPAWN_TIMEOUT_MS
    )
  })
  return await Promise.race([
    spawnAgent({ prompt, cwd, model, logger, maxBudgetUsd, pipelineTuning, worktreeBase }),
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
