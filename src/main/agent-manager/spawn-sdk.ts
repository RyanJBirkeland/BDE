/**
 * SDK-based agent spawn implementation.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` call with session-ID
 * extraction, abort controller wiring, and a steer() stub.
 */
import type { AgentHandle, SteerResult, SpawnStrategy } from './types'
import type { SDKWireMessage } from './sdk-message-protocol'
import type { Logger } from '../logger'
import { randomUUID } from 'node:crypto'
import { getClaudeCliPath } from '../env-utils'
import { FLEET_MEMORY_DIR } from '../paths'
import { getSessionId } from './sdk-message-protocol'
import { createWorktreeIsolationHook } from './worktree-isolation-hook'

/** Fallback turn limit when no pipelineTuning is supplied. Configurable via Settings → Agents. */
export const MAX_TURNS = 1000

/**
 * Pipeline-agent-only SDK tuning. These values are computed from the task spec
 * and do not apply to adhoc, assistant, copilot, or synthesizer agents — each
 * of those has its own spawn path.
 */
export interface PipelineSpawnTuning {
  /** Overrides the default turn cap for this spawn. */
  maxTurns?: number
  /** Tool patterns removed from the model's available tool list. */
  disallowedTools?: readonly string[]
}

export function spawnViaSdk(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  opts: {
    prompt: string
    cwd: string
    model: string
    maxBudgetUsd?: number | undefined
    pipelineTuning?: PipelineSpawnTuning | undefined
    taskId?: string | undefined
    agentType?: string | undefined
    tickId?: string | undefined
    /**
     * Absolute paths of the main repository checkouts on disk.
     * Used by the worktree isolation hook to deny agent writes to main repo paths.
     * Required when `pipelineTuning` is set; ignored otherwise.
     */
    mainRepoPaths?: readonly string[] | undefined
  },
  env: NodeJS.ProcessEnv,
  token: string | null,
  strategy: SpawnStrategy,
  logger?: Logger
): AgentHandle {
  const abortController = new AbortController()

  const effectiveMaxTurns = opts.pipelineTuning?.maxTurns ?? MAX_TURNS
  const effectiveDisallowedTools = opts.pipelineTuning?.disallowedTools
    ? [...opts.pipelineTuning.disallowedTools]
    : undefined

  const effectiveMaxBudget = opts.maxBudgetUsd ?? 2.0
  if (logger) {
    logger.event('agent.spawn', {
      taskId: opts.taskId ?? 'unknown',
      tickId: opts.tickId,
      agentType: opts.agentType ?? 'unknown',
      model: opts.model,
      maxBudgetUsd: effectiveMaxBudget,
      cwd: opts.cwd,
      backend: strategy.type
    })
  }

  const queryResult = sdk.query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      cwd: opts.cwd,
      env: env as Record<string, string | undefined>,
      pathToClaudeCodeExecutable: getClaudeCliPath(),
      ...(token ? { apiKey: token } : {}),
      abortController,
      // Pipeline agents run in isolated worktrees — the isolation hook
      // refuses any write/edit/bash path that escapes the worktree and points
      // at a configured main-repo checkout, so a stray absolute path cannot
      // mutate the primary working copy. Non-pipeline spawns (adhoc,
      // assistant, copilot, synthesizer, reviewer) run in the repo directly
      // and stay on the permissive fallback.
      canUseTool: opts.pipelineTuning
        ? createWorktreeIsolationHook({
            worktreePath: opts.cwd,
            mainRepoPaths: opts.mainRepoPaths ? [...opts.mainRepoPaths] : [],
            extraAllowedPaths: [FLEET_MEMORY_DIR],
            logger
          })
        : async () => ({ behavior: 'allow' as const }),
      // Pipeline agents receive FLEET conventions via the composed prompt —
      // loading CLAUDE.md via 'project' would double-inject conventions and
      // costs ~5-10KB extra per spawn. User hooks kept for permission settings;
      // local overrides kept for dev convenience.
      settingSources: ['user', 'local'],
      // Configurable via Settings → Agents (default 1000). Watchdog provides
      // an independent time ceiling via maxRuntimeMs.
      maxTurns: effectiveMaxTurns,
      // Pipeline agents are autonomous with no human at stdin. Cap spend per spawn
      // to prevent runaway cost on loops. Default 2.0 USD covers complex multi-file
      // refactors. Override via task.max_cost_usd for long-running tasks.
      maxBudgetUsd: opts.maxBudgetUsd ?? 2.0,
      // Block reconnaissance Bash subcommands that burn turns without producing
      // value when the spec already names the target files.
      ...(effectiveDisallowedTools ? { disallowedTools: effectiveDisallowedTools } : {})
    }
  })

  // Extract sessionId from the first message that carries it; subsequent
  // messages with a different session_id are ignored — only the first wins.
  let resolvedSessionId = randomUUID()
  let sessionIdResolved = false

  async function* wrapMessages(): AsyncIterable<unknown> {
    for await (const msg of queryResult) {
      if (!sessionIdResolved) {
        const sid = getSessionId(msg)
        if (sid) {
          resolvedSessionId = sid as ReturnType<typeof randomUUID>
          sessionIdResolved = true
        }
      }
      yield msg
    }
  }

  return {
    // wrapMessages() yields unknown values narrowed at consumption time via asSDKMessage().
    messages: wrapMessages() as AsyncIterable<SDKWireMessage>,
    get sessionId() {
      return resolvedSessionId
    },
    abort() {
      abortController.abort()
    },
    async steer(message: string): Promise<SteerResult> {
      // SDK mode does not support mid-session steering — returns delivered: false. CLI mode writes to stdin. Callers must handle delivered === false.
      // Log only the message length, never the body — steer messages are user-supplied content and project policy keeps them out of `~/.fleet/fleet.log`.
      ;(logger ?? console).warn(
        `[agent-manager] Steer not supported in SDK mode (message length: ${message.length})`
      )
      return { delivered: false, error: 'SDK mode does not support steering' }
    }
  }
}
