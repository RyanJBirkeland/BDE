/**
 * Agent cost/token tracking and SQL persistence.
 *
 * Extracts cost fields from SDK messages, accumulates them on the
 * active-agent record, and persists finalized telemetry to SQLite.
 */
import type { ActiveAgent } from './types'
import type { Logger } from '../logger'
import { TurnTracker } from './turn-tracker'
import { getNumericField } from './sdk-message-protocol'
import { updateAgentMeta } from '../agent-history'
import { updateAgentRunCost } from '../data/agent-queries'
import { getDb } from '../db'

/**
 * Anthropic model pricing in USD per million tokens.
 * Source: Anthropic public pricing page + SDK cli.js embedded table.
 * Key is a normalized model family prefix (matched via .includes()).
 * Ordered from most-specific to least-specific so the first match wins.
 */
const MODEL_PRICING: Array<{
  match: string
  inputUsdPerM: number
  outputUsdPerM: number
  cacheReadUsdPerM: number
  cacheCreateUsdPerM: number
}> = [
  // Haiku 3.5
  { match: 'claude-3-5-haiku', inputUsdPerM: 0.8, outputUsdPerM: 4, cacheReadUsdPerM: 0.08, cacheCreateUsdPerM: 1 },
  // Haiku 4.5
  { match: 'claude-haiku-4-5', inputUsdPerM: 1, outputUsdPerM: 5, cacheReadUsdPerM: 0.1, cacheCreateUsdPerM: 1.25 },
  // Sonnet 3.5 / 3.7
  { match: 'claude-3-5-sonnet', inputUsdPerM: 3, outputUsdPerM: 15, cacheReadUsdPerM: 0.3, cacheCreateUsdPerM: 3.75 },
  { match: 'claude-3-7-sonnet', inputUsdPerM: 3, outputUsdPerM: 15, cacheReadUsdPerM: 0.3, cacheCreateUsdPerM: 3.75 },
  // Sonnet 4 family
  { match: 'claude-sonnet-4', inputUsdPerM: 3, outputUsdPerM: 15, cacheReadUsdPerM: 0.3, cacheCreateUsdPerM: 3.75 },
  // Opus 4 — more expensive models
  { match: 'claude-opus-4-5', inputUsdPerM: 5, outputUsdPerM: 25, cacheReadUsdPerM: 0.5, cacheCreateUsdPerM: 6.25 },
  { match: 'claude-opus-4-6', inputUsdPerM: 5, outputUsdPerM: 25, cacheReadUsdPerM: 0.5, cacheCreateUsdPerM: 6.25 },
  { match: 'claude-opus-4', inputUsdPerM: 15, outputUsdPerM: 75, cacheReadUsdPerM: 1.5, cacheCreateUsdPerM: 18.75 },
]

/**
 * Computes cost in USD from token totals and model pricing.
 *
 * Pipeline agents often exit before the SDK subprocess can yield the
 * `result` message that carries `total_cost_usd` — either because BDE
 * aborts the stream when maxTurns is reached, or because the subprocess
 * is killed by the OS. This function provides a local cost estimate so
 * `agent_runs.cost_usd` is never left at 0 when real token usage exists.
 */
export function computeTokenCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  cacheTokensRead: number,
  cacheTokensCreated: number
): number {
  const pricing = MODEL_PRICING.find((p) => model.includes(p.match))
  if (!pricing) return 0

  const PER_MILLION = 1_000_000
  return (
    (tokensIn / PER_MILLION) * pricing.inputUsdPerM +
    (tokensOut / PER_MILLION) * pricing.outputUsdPerM +
    (cacheTokensRead / PER_MILLION) * pricing.cacheReadUsdPerM +
    (cacheTokensCreated / PER_MILLION) * pricing.cacheCreateUsdPerM
  )
}

/**
 * Updates agent cost and token fields from a single SDK message.
 * Called for every message in the stream.
 */
export function trackAgentCosts(msg: unknown, agent: ActiveAgent, turnTracker: TurnTracker): void {
  agent.costUsd =
    getNumericField(msg, 'cost_usd') ?? getNumericField(msg, 'total_cost_usd') ?? agent.costUsd
  turnTracker.processMessage(msg)
  const { tokensIn, tokensOut } = turnTracker.totals()
  agent.tokensIn = tokensIn
  agent.tokensOut = tokensOut
}

/**
 * Fire-and-forget: updates the agent_runs record and persists cost/token totals.
 * Non-blocking — failures are logged as warnings, not propagated.
 */
export function persistAgentRunTelemetry(
  agentRunId: string,
  agent: ActiveAgent,
  exitCode: number | undefined,
  turnTracker: TurnTracker,
  exitedAt: number,
  durationMs: number,
  logger: Logger
): void {
  const totals = turnTracker.totals()
  const hasTokenUsage = totals.tokensIn > 0 || totals.tokensOut > 0 || totals.cacheTokensRead > 0

  // Pipeline agents often exit before the SDK subprocess yields the final
  // result message (e.g. when maxTurns is hit or the process is killed).
  // Fall back to a local estimate so cost_usd is never left at 0 when
  // real token usage is present.
  const effectiveCostUsd =
    agent.costUsd > 0
      ? agent.costUsd
      : hasTokenUsage
        ? computeTokenCost(
            agent.model,
            totals.tokensIn,
            totals.tokensOut,
            totals.cacheTokensRead,
            totals.cacheTokensCreated
          )
        : 0

  updateAgentMeta(agentRunId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date(exitedAt).toISOString(),
    exitCode: exitCode ?? null,
    costUsd: effectiveCostUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut
  }).catch((err) =>
    logger.warn(
      `[agent-manager] Failed to update agent record for ${agentRunId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    )
  )

  try {
    updateAgentRunCost(getDb(), agentRunId, {
      costUsd: effectiveCostUsd,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      cacheRead: totals.cacheTokensRead,
      cacheCreate: totals.cacheTokensCreated,
      durationMs,
      numTurns: totals.turnCount
    })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist cost breakdown for ${agentRunId}: ${err}`)
  }
}
