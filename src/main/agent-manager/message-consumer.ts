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
import { createPlaygroundDetector } from './playground-handler'
import type { PlaygroundWriteResult } from './playground-handler'
import { TurnTracker } from './turn-tracker'
import type { AgentRunClaim } from './run-agent'
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers'
import { invalidateOAuthToken, refreshOAuthTokenFromKeychain } from '../env-utils'

/**
 * Maximum time between consecutive messages before the stream is considered stalled.
 * 2 minutes is deliberately conservative — a healthy network should never approach this.
 */
export const MESSAGE_STALL_TIMEOUT_MS = 120_000

/**
 * Module-level override for the stall timeout — settable only in tests.
 * Uses `node:timers` (not the global `setTimeout`) so the stall deadline runs
 * on the real system clock and is not disturbed by `vi.useFakeTimers()` in
 * unrelated test suites. Production code never calls `__setStallTimeoutMsForTesting`.
 */
let stallTimeoutMs = MESSAGE_STALL_TIMEOUT_MS
export function __setStallTimeoutMsForTesting(ms: number): void {
  stallTimeoutMs = ms
}

export function __resetStallTimeoutForTesting(): void {
  stallTimeoutMs = MESSAGE_STALL_TIMEOUT_MS
}

/** Sentinel returned by the per-iteration race when the deadline fires. */
const STALL_SENTINEL = Symbol('stall')

/**
 * Races `iter.next()` against a per-message deadline.
 * Uses `node:timers` `setTimeout` (bypasses Vitest fake-timer patching) so the
 * stall clock runs on real wall time and does not fire when test suites advance
 * fake timers for drain-loop polling intervals.
 * Clears the timer when the iterator resolves first to prevent timer leaks.
 * Returns the iterator result, or `STALL_SENTINEL` if no message arrives in time.
 */
async function nextOrStall(
  iter: AsyncIterator<unknown>
): Promise<IteratorResult<unknown> | typeof STALL_SENTINEL> {
  let stallTimer: ReturnType<typeof nodeSetTimeout>
  const stallPromise: Promise<typeof STALL_SENTINEL> = new Promise<typeof STALL_SENTINEL>(
    (resolve) => {
      stallTimer = nodeSetTimeout(() => resolve(STALL_SENTINEL), stallTimeoutMs)
    }
  )
  try {
    const result = await Promise.race([iter.next(), stallPromise])
    nodeClearTimeout(stallTimer!)
    return result
  } catch (err) {
    nodeClearTimeout(stallTimer!)
    throw err
  }
}

export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError?: Error
  pendingPlaygroundPaths: PlaygroundWriteResult[]
}

/**
 * Raised when an OAuth refresh fails after an auth error.
 * Callers can `instanceof`-check this without comparing error message strings.
 */
export class OAuthRefreshFailedError extends Error {
  constructor(message = 'OAuth refresh failed after auth error — stream aborted') {
    super(message)
    this.name = 'OAuthRefreshFailedError'
  }
}

/**
 * Awaits an OAuth token refresh after an auth error.
 *
 * Returns `true` when the new token is on disk, `false` when the refresh
 * failed or threw. The caller receives a boolean so it can decide whether
 * to let the stream retry cleanly or abort with `OAuthRefreshFailedError`.
 */
async function handleOAuthRefresh(
  logger: Logger,
  onRefreshStarted?: (promise: Promise<unknown>) => void
): Promise<boolean> {
  invalidateOAuthToken()
  logger.warn('[agent-manager] Auth failure detected — OAuth token cache invalidated')
  try {
    const refreshed = await refreshOAuthTokenFromKeychain()
    if (refreshed) {
      logger.info('[agent-manager] OAuth token auto-refreshed from Keychain after auth failure')
      onRefreshStarted?.(Promise.resolve())
      return true
    }
    onRefreshStarted?.(Promise.resolve())
    return false
  } catch (err) {
    logError(logger, '[agent-manager] Failed to auto-refresh OAuth token after auth failure', err)
    onRefreshStarted?.(Promise.resolve())
    return false
  }
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
 * Processes a single message: tracks costs, emits events.
 * Playground detection lives in the calling loop because it needs
 * per-session state (tool_use / tool_result pairing).
 */
function processSDKMessage(
  msg: unknown,
  agent: ActiveAgent,
  agentRunId: string,
  turnTracker: TurnTracker,
  exitCode: number | undefined,
  lastAgentOutput: string
): {
  exitCode: number | undefined
  lastAgentOutput: string
} {
  agent.lastOutputAt = Date.now()

  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++
  }

  trackAgentCosts(msg, agent, turnTracker)
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode

  const mappedEvents = mapRawMessage(msg, agentRunId)
  for (const event of mappedEvents) {
    emitAgentEvent(agentRunId, event)
  }

  const m = asSDKMessage(msg)
  if (m?.type === 'assistant' && typeof m.text === 'string') {
    lastAgentOutput = m.text.slice(-LAST_OUTPUT_MAX_LENGTH)
  }

  return { exitCode, lastAgentOutput }
}

/**
 * Consumes SDK message stream, tracking costs, emitting events, and accumulating playground paths.
 * Playground HTML paths are collected but not emitted — the caller awaits emission
 * after the stream ends to prevent worktree cleanup from racing async file reads.
 *
 * `onOAuthRefreshStart` — when provided, called with the in-flight Keychain
 * refresh promise so the drain loop can await token availability before the
 * next spawn (see `AgentManager.awaitOAuthRefresh`).
 */
export async function consumeMessages(
  handle: AgentHandle,
  agent: ActiveAgent,
  task: AgentRunClaim,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger,
  maxTurns: number,
  onOAuthRefreshStart?: (promise: Promise<unknown>) => void
): Promise<ConsumeMessagesResult> {
  let exitCode: number | undefined
  let lastAgentOutput = ''
  const pendingPlaygroundPaths: PlaygroundWriteResult[] = []
  const playgroundDetector = createPlaygroundDetector()
  let turnCount = 0
  let messagesConsumed = 0
  let lastEventType = 'none'

  const iter = handle.messages[Symbol.asyncIterator]()
  try {
    // Manual iteration instead of `for await` so each `iter.next()` call
    // can be raced against a per-message deadline.  If no message arrives
    // within MESSAGE_STALL_TIMEOUT_MS the stream is declared stalled and
    // the loop exits early with a structured streamError.
    while (true) {
      const raceResult = await nextOrStall(iter)

      if (raceResult === STALL_SENTINEL) {
        logger.event('agent.stream.error', {
          reason: 'stalled',
          taskId: task.id,
          messagesConsumed,
          lastEventType
        })
        const stallError = new Error('stream_stalled')
        emitAgentEvent(agentRunId, {
          type: 'agent:error',
          message: `Stream interrupted: stream stalled — no message in ${MESSAGE_STALL_TIMEOUT_MS / 1000}s`,
          timestamp: Date.now(),
          taskId: task.id,
          messagesConsumed,
          lastEventType
        })
        flushAgentEventBatcher()
        return { exitCode, lastAgentOutput, streamError: stallError, pendingPlaygroundPaths }
      }

      if (raceResult.done) break

      const msg = raceResult.value
      messagesConsumed++
      const sdkMsg = asSDKMessage(msg)
      if (sdkMsg?.type) {
        lastEventType = sdkMsg.type
      }
      const result = processSDKMessage(
        msg,
        agent,
        agentRunId,
        turnTracker,
        exitCode,
        lastAgentOutput
      )
      exitCode = result.exitCode
      lastAgentOutput = result.lastAgentOutput

      if (task.playground_enabled) {
        const playgroundHit = playgroundDetector.onMessage(msg)
        if (playgroundHit) pendingPlaygroundPaths.push(playgroundHit)
      }

      // Hard turn limit: abort if agent exceeds maxTurns (SDK soft limit may not enforce)
      const m = asSDKMessage(msg)
      if (m?.type === 'assistant') {
        turnCount++
        if (turnCount > maxTurns) {
          logger.warn(
            `[agent-manager] maxTurns (${maxTurns}) reached for task ${task.id} — aborting`
          )
          handle.abort()
          const turnsError = new Error('max_turns_exceeded')
          emitAgentEvent(agentRunId, {
            type: 'agent:error',
            message: turnsError.message,
            timestamp: Date.now(),
            taskId: task.id
          })
          flushAgentEventBatcher()
          return { exitCode, lastAgentOutput, streamError: turnsError, pendingPlaygroundPaths }
        }
      }

      // Per-turn budget check: abort immediately if cost exceeds limit
      if (agent.maxCostUsd !== null && agent.costUsd >= agent.maxCostUsd) {
        logger.warn(
          `[agent-manager] Cost budget $${agent.maxCostUsd.toFixed(2)} exceeded ($${agent.costUsd.toFixed(2)} spent) — aborting task ${task.id}`
        )
        handle.abort()
        const budgetError = new Error(
          `Cost budget $${agent.maxCostUsd.toFixed(2)} exceeded ($${agent.costUsd.toFixed(2)} spent)`
        )
        emitAgentEvent(agentRunId, {
          type: 'agent:error',
          message: budgetError.message,
          timestamp: Date.now(),
          taskId: task.id
        })
        flushAgentEventBatcher()
        return {
          exitCode,
          lastAgentOutput,
          streamError: budgetError,
          pendingPlaygroundPaths
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.event('agent.stream.error', {
      taskId: task.id,
      messagesConsumed,
      lastEventType,
      error: errMsg
    })
    logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)

    const isAuthError =
      errMsg.includes('Invalid API key') ||
      errMsg.includes('invalid_api_key') ||
      errMsg.includes('authentication')

    if (isAuthError) {
      const refreshSucceeded = await handleOAuthRefresh(logger, onOAuthRefreshStart)
      if (refreshSucceeded) {
        // Token is fresh — caller can retry cleanly; no streamError.
        flushAgentEventBatcher()
        return { exitCode, lastAgentOutput, pendingPlaygroundPaths }
      }
      // Refresh failed: abort the handle and return a typed error so the caller
      // can distinguish "auth failure we already handled" from generic stream errors.
      handle.abort()
      const refreshError = new OAuthRefreshFailedError()
      emitAgentEvent(agentRunId, {
        type: 'agent:error',
        message: `Stream interrupted: OAuth refresh failed after auth error — stream aborted`,
        timestamp: Date.now(),
        taskId: task.id,
        messagesConsumed,
        lastEventType
      })
      flushAgentEventBatcher()
      return { exitCode, lastAgentOutput, streamError: refreshError, pendingPlaygroundPaths }
    }

    emitAgentEvent(agentRunId, {
      type: 'agent:error',
      message: `Stream interrupted: ${errMsg}`,
      timestamp: Date.now(),
      taskId: task.id,
      messagesConsumed,
      lastEventType
    })
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
