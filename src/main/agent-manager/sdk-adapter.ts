/**
 * SDK adapter — thin facade over spawn-sdk, spawn-cli, and sdk-message-protocol.
 *
 * Public API (`spawnAgent`, `spawnWithTimeout`) is unchanged.
 * Protocol helpers re-exported for callers that import them from here.
 */
import type { AgentHandle } from './types'
import type { Logger } from '../logger'
import { SPAWN_TIMEOUT_MS } from './types'
import { buildAgentEnv, getOAuthToken } from '../env-utils'
import { spawnViaSdk } from './spawn-sdk'
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
}): Promise<AgentHandle> {
  const env = { ...buildAgentEnv() }

  // Get OAuth token for SDK auth (not passed via env)
  const token = getOAuthToken()

  // Try SDK first, fall back to CLI
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return spawnViaSdk(sdk, opts, env, token, opts.logger)
  } catch {
    // SDK not available — use CLI fallback
  }

  return spawnViaCli(opts, env, token, opts.logger)
}

/**
 * Spawns an agent with a timeout. Rejects if spawn takes longer than SPAWN_TIMEOUT_MS.
 */
export async function spawnWithTimeout(
  prompt: string,
  cwd: string,
  model: string,
  logger: Logger,
  maxBudgetUsd?: number
): Promise<AgentHandle> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
      SPAWN_TIMEOUT_MS
    )
  })
  return await Promise.race([
    spawnAgent({ prompt, cwd, model, logger, maxBudgetUsd }),
    timeoutPromise
  ]).finally(() => clearTimeout(timer!))
}
