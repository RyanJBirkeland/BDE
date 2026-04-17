/**
 * SDK-based agent spawn implementation.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` call with session-ID
 * extraction, abort controller wiring, and a steer() stub.
 */
import type { AgentHandle, SteerResult } from './types'
import type { Logger } from '../logger'
import { randomUUID } from 'node:crypto'
import { getClaudeCliPath } from '../env-utils'
import { getSessionId } from './sdk-message-protocol'

/**
 * Baseline turn limit used when a caller does not supply a spec-aware override.
 * Kept exported for callers (e.g. `message-consumer.ts`) that defend against
 * runaway loops independently of the SDK-level cap.
 */
export const MAX_TURNS = 20

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
    maxBudgetUsd?: number
    pipelineTuning?: PipelineSpawnTuning
  },
  env: NodeJS.ProcessEnv,
  token: string | null,
  logger?: Logger
): AgentHandle {
  const abortController = new AbortController()

  const effectiveMaxTurns = opts.pipelineTuning?.maxTurns ?? MAX_TURNS
  const effectiveDisallowedTools = opts.pipelineTuning?.disallowedTools
    ? [...opts.pipelineTuning.disallowedTools]
    : undefined

  const queryResult = sdk.query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      cwd: opts.cwd,
      env: env as Record<string, string | undefined>,
      pathToClaudeCodeExecutable: getClaudeCliPath(),
      ...(token ? { apiKey: token } : {}),
      abortController,
      // Pipeline agents are autonomous (no human at stdin) and run in
      // isolated worktrees. Auto-allow all tools to prevent hanging on
      // permission prompts. Safety comes from worktree isolation + PR review.
      canUseTool: async () => ({ behavior: 'allow' as const }),
      // Pipeline agents receive BDE conventions via the composed prompt —
      // loading CLAUDE.md via 'project' would double-inject conventions and
      // costs ~5-10KB extra per spawn. User hooks kept for permission settings;
      // local overrides kept for dev convenience.
      settingSources: ['user', 'local'],
      // Spec-aware turn cap: 30 default, 50 for mixed-stack, 75 for explicitly
      // multi-file specs. Falls back to MAX_TURNS when no tuning is supplied.
      // See turn-budget.ts for the rule tree. Watchdog still provides an
      // independent time ceiling.
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

  // Extract sessionId from the first message that carries it
  let resolvedSessionId = randomUUID()

  async function* wrapMessages(): AsyncIterable<unknown> {
    for await (const msg of queryResult) {
      const sid = getSessionId(msg)
      if (sid && sid !== resolvedSessionId) {
        resolvedSessionId = sid as ReturnType<typeof randomUUID>
      }
      yield msg
    }
  }

  return {
    messages: wrapMessages(),
    get sessionId() {
      return resolvedSessionId
    },
    abort() {
      abortController.abort()
    },
    async steer(message: string): Promise<SteerResult> {
      // SDK mode does not support mid-session steering — returns delivered: false. CLI mode writes to stdin. Callers must handle delivered === false.
      ;(logger ?? console).warn(
        `[agent-manager] Steer not supported in SDK mode: "${message.slice(0, 100)}"`
      )
      return { delivered: false, error: 'SDK mode does not support steering' }
    }
  }
}
