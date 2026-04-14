/**
 * SDK message stream consumption.
 *
 * Iterates the agent message stream, tracking costs and emitting events.
 * Handles OAuth refresh on auth errors, and accumulates playground HTML paths
 * for deferred emission after the stream ends.
 */
import type { AgentHandle, ActiveAgent } from './types'
import type { Logger } from '../logger'
import { logError } from '../logger'
import { LAST_OUTPUT_MAX_LENGTH } from './types'
import { asSDKMessage, getNumericField, isRateLimitMessage } from './sdk-message-protocol'
import { mapRawMessage, emitAgentEvent, flushAgentEventBatcher } from '../agent-event-mapper'
import { detectHtmlWrite } from './playground-handler'
import { TurnTracker } from './turn-tracker'
import type { RunAgentTask } from './run-agent'

export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError?: Error
  pendingPlaygroundPaths: string[]
}

/**
 * Handles OAuth token refresh after auth errors.
 */
async function handleOAuthRefresh(logger: Logger): Promise<void> {
  const { invalidateOAuthToken, refreshOAuthTokenFromKeychain } = await import('../env-utils')
  invalidateOAuthToken()
  // Intentionally fire-and-forget: Keychain access on macOS can block for several seconds.
  // Awaiting it here would stall the entire message-consumer loop while the stream is still live.
  // The next agent spawn will pick up the refreshed token; errors are logged via .catch() below.
  refreshOAuthTokenFromKeychain()
    .then((ok) => {
      if (ok)
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain after auth failure')
    })
    .catch((err) => {
      logError(logger, '[agent-manager] Failed to auto-refresh OAuth token after auth failure', err)
    })
  logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
}

/**
 * Updates agent cost and token fields from SDK message.
 */
function trackAgentCosts(msg: unknown, agent: ActiveAgent, turnTracker: TurnTracker): void {
  agent.costUsd =
    getNumericField(msg, 'cost_usd') ?? getNumericField(msg, 'total_cost_usd') ?? agent.costUsd
  turnTracker.processMessage(msg)
  const { tokensIn, tokensOut } = turnTracker.totals()
  agent.tokensIn = tokensIn
  agent.tokensOut = tokensOut
}

/**
 * Processes a single message: tracks costs, emits events, detects playground HTML writes.
 * Returns detectedHtmlPath instead of emitting playground events inline —
 * callers accumulate paths and await emission after the stream ends,
 * preventing worktree cleanup from racing the async file read.
 */
function processSDKMessage(
  msg: unknown,
  agent: ActiveAgent,
  task: RunAgentTask,
  agentRunId: string,
  turnTracker: TurnTracker,
  exitCode: number | undefined,
  lastAgentOutput: string
): { exitCode: number | undefined; lastAgentOutput: string; detectedHtmlPath: string | null } {
  agent.lastOutputAt = Date.now()

  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++
  }

  trackAgentCosts(msg, agent, turnTracker)
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode

  const mappedEvents = mapRawMessage(msg)
  for (const event of mappedEvents) {
    emitAgentEvent(agentRunId, event)
  }

  const detectedHtmlPath = task.playground_enabled ? detectHtmlWrite(msg) : null

  const m = asSDKMessage(msg)
  if (m?.type === 'assistant' && typeof m.text === 'string') {
    lastAgentOutput = m.text.slice(-LAST_OUTPUT_MAX_LENGTH)
  }

  return { exitCode, lastAgentOutput, detectedHtmlPath }
}

/**
 * Consumes SDK message stream, tracking costs, emitting events, and accumulating playground paths.
 * Playground HTML paths are collected but not emitted — the caller awaits emission
 * after the stream ends to prevent worktree cleanup from racing async file reads.
 */
export async function consumeMessages(
  handle: AgentHandle,
  agent: ActiveAgent,
  task: RunAgentTask,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger
): Promise<ConsumeMessagesResult> {
  let exitCode: number | undefined
  let lastAgentOutput = ''
  const pendingPlaygroundPaths: string[] = []

  try {
    for await (const msg of handle.messages) {
      const result = processSDKMessage(
        msg,
        agent,
        task,
        agentRunId,
        turnTracker,
        exitCode,
        lastAgentOutput
      )
      exitCode = result.exitCode
      lastAgentOutput = result.lastAgentOutput
      if (result.detectedHtmlPath) {
        pendingPlaygroundPaths.push(result.detectedHtmlPath)
      }
    }
  } catch (err) {
    logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    emitAgentEvent(agentRunId, {
      type: 'agent:error',
      message: `Stream interrupted: ${errMsg}`,
      timestamp: Date.now()
    })
    if (
      errMsg.includes('Invalid API key') ||
      errMsg.includes('invalid_api_key') ||
      errMsg.includes('authentication')
    ) {
      await handleOAuthRefresh(logger)
    }
    // Flush immediately: the batcher's 100ms timer may not fire before the
    // next drain tick or process shutdown, so the stream-error event would
    // be lost. Flushing here guarantees it reaches SQLite.
    flushAgentEventBatcher()
    return {
      exitCode,
      lastAgentOutput,
      streamError: err instanceof Error ? err : new Error(errMsg),
      pendingPlaygroundPaths
    }
  }

  return { exitCode, lastAgentOutput, pendingPlaygroundPaths }
}
