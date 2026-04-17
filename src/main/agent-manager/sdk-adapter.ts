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
import { homedir } from 'node:os'
import { DEFAULT_CONFIG, SPAWN_TIMEOUT_MS } from './types'
import { buildAgentEnv, getOAuthToken } from '../env-utils'
import { resolveNodeExecutable } from './resolve-node'
import { spawnViaSdk, type PipelineSpawnTuning } from './spawn-sdk'
import { spawnViaCli } from './spawn-cli'
import { loadBackendSettings, resolveBackend } from './backend-selector'
import { spawnLocalAgent } from './local-adapter'

/**
 * Pipeline agents must only spawn with a `cwd` inside a BDE-managed worktree
 * base. Any other cwd — the main repo, /tmp, or the user's home — means the
 * agent would write directly to a location that should be isolated from the
 * main checkout. This is the last-chance check before the SDK / CLI actually
 * starts the process.
 *
 * The allowlist covers the default worktree base AND the uppercase
 * `~/worktrees/BDE/` path used by the current BDE layout.
 */
const ALLOWED_WORKTREE_BASES: readonly string[] = [
  DEFAULT_CONFIG.worktreeBase,
  `${homedir()}/worktrees/BDE`
]

function isInsideAllowedWorktreeBase(cwd: string): boolean {
  const resolved = resolvePath(cwd)
  return ALLOWED_WORKTREE_BASES.some((base) => resolved.startsWith(resolvePath(base) + '/'))
}

function assertCwdIsInsideWorktreeBase(cwd: string): void {
  if (!isInsideAllowedWorktreeBase(cwd)) {
    throw new Error(
      `Refusing to spawn agent: cwd "${cwd}" is not inside any allowed worktree base (${ALLOWED_WORKTREE_BASES.join(', ')}). ` +
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
  maxBudgetUsd?: number
  logger?: Logger
  /**
   * Which agent type is being spawned. Routes through the backend-selector to
   * pick Claude vs. the local `rbt-coding-agent` backend based on settings.
   * Defaults to `'pipeline'` because today only the Pipeline path flows
   * through this function — other agent types (adhoc, copilot, synthesizer,
   * assistant, reviewer) have their own dedicated spawn paths.
   */
  agentType?: AgentType
  /**
   * Pipeline-agent-only overrides for SDK options. Adhoc, assistant, copilot,
   * and synthesizer agents use their own spawn paths and never set this.
   */
  pipelineTuning?: PipelineSpawnTuning
}): Promise<AgentHandle> {
  // Worktree-base cwd assertion applies only to pipeline agents — adhoc,
  // assistant, copilot, and synthesizer agents run in the user's repo or
  // freeform directories and are gated elsewhere. Pipeline agents are the
  // ones that can leak edits into the main repo if misrouted.
  if (opts.pipelineTuning) {
    assertCwdIsInsideWorktreeBase(opts.cwd)
  }

  const agentType: AgentType = opts.agentType ?? 'pipeline'
  const settings = loadBackendSettings()
  const resolved = resolveBackend(agentType, settings)

  if (resolved.backend === 'local') {
    try {
      return await spawnLocalAgent({
        prompt: opts.prompt,
        cwd: opts.cwd,
        model: resolved.model,
        endpoint: settings.localEndpoint,
        logger: opts.logger
      })
    } catch (err) {
      opts.logger?.warn(
        `[agent-manager] local backend for ${agentType} failed; falling back to Claude: ${(err as Error).message}`
      )
      // Fall through to Claude path below.
    }
  }

  const modelForClaude = resolved.backend === 'claude' ? resolved.model : opts.model
  return spawnClaudeAgent({ ...opts, model: modelForClaude })
}

async function spawnClaudeAgent(opts: {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number
  logger?: Logger
  pipelineTuning?: PipelineSpawnTuning
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
  pipelineTuning?: PipelineSpawnTuning
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
      SPAWN_TIMEOUT_MS
    )
  })
  return await Promise.race([
    spawnAgent({ prompt, cwd, model, logger, maxBudgetUsd, pipelineTuning }),
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
