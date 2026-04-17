/**
 * SDK adapter — thin facade over spawn-sdk, spawn-cli, and sdk-message-protocol.
 *
 * Public API (`spawnAgent`, `spawnWithTimeout`) is unchanged.
 * Protocol helpers re-exported for callers that import them from here.
 */
import type { AgentHandle } from './types'
import type { Logger } from '../logger'
import { dirname } from 'node:path'
import { SPAWN_TIMEOUT_MS } from './types'
import { buildAgentEnv, getOAuthToken } from '../env-utils'
import { resolveNodeExecutable } from './resolve-node'
import { spawnViaSdk, type PipelineSpawnTuning } from './spawn-sdk'
import { spawnViaCli } from './spawn-cli'

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
   * Pipeline-agent-only overrides for SDK options. Adhoc, assistant, copilot,
   * and synthesizer agents use their own spawn paths and never set this.
   */
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
