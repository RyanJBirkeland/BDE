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
  updateAgentMeta(agentRunId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date(exitedAt).toISOString(),
    exitCode: exitCode ?? null,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut
  }).catch((err) =>
    logger.warn(
      `[agent-manager] Failed to update agent record for ${agentRunId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    )
  )

  try {
    const totals = turnTracker.totals()
    updateAgentRunCost(getDb(), agentRunId, {
      costUsd: agent.costUsd ?? 0,
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
