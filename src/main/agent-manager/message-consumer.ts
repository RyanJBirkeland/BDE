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
 * Mutable holder for the stall timer, passed across `nextOrStall` calls so a
 * single timer object is reused rather than allocating a new one per message.
 */
interface StallTimerState {
  handle: ReturnType<typeof nodeSetTimeout> | undefined
}

/**
 * Races `iter.next()` against a per-message deadline.
 *
 * Accepts a `timerState` holder that is shared across calls — on each
 * invocation the previous timer is cleared and the handle is rescheduled,
 * avoiding one `nodeSetTimeout` allocation per message (T-41).
 *
 * Uses `node:timers` `setTimeout` (bypasses Vitest fake-timer patching) so the
 * stall clock runs on real wall time and does not fire when test suites advance
 * fake timers for drain-loop polling intervals.
 * Clears the timer when the iterator resolves first to prevent timer leaks.
 * Returns the iterator result, or `STALL_SENTINEL` if no message arrives in time.
 */
async function nextOrStall(
  iter: AsyncIterator<unknown>,
  timerState: StallTimerState
): Promise<IteratorResult<unknown> | typeof STALL_SENTINEL> {
  // Clear any timer from the previous iteration before rescheduling.
  if (timerState.handle !== undefined) {
    nodeClearTimeout(timerState.handle)
  }

  const stallPromise: Promise<typeof STALL_SENTINEL> = new Promise<typeof STALL_SENTINEL>(
    (resolve) => {
      timerState.handle = nodeSetTimeout(() => resolve(STALL_SENTINEL), stallTimeoutMs)
    }
  )
  try {
    const result = await Promise.race([iter.next(), stallPromise])
    nodeClearTimeout(timerState.handle)
    timerState.handle = undefined
    return result
  } catch (err) {
    nodeClearTimeout(timerState.handle)
    timerState.handle = undefined
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
 * Accepts a pre-parsed `sdkMsg` to avoid calling `asSDKMessage` more than
 * once per loop iteration.
 * Playground detection lives in the calling loop because it needs
 * per-session state (tool_use / tool_result pairing).
 */
function processSDKMessage(
  msg: unknown,
  sdkMsg: ReturnType<typeof asSDKMessage>,
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

  if (sdkMsg?.type === 'assistant' && typeof sdkMsg.text === 'string') {
    lastAgentOutput = sdkMsg.text.slice(-LAST_OUTPUT_MAX_LENGTH)
  }

  return { exitCode, lastAgentOutput }
}

/** Shared context threaded through the message loop sub-functions. */
interface MessageLoopContext {
  handle: AgentHandle
  agent: ActiveAgent
  task: AgentRunClaim
  agentRunId: string
  logger: Logger
  maxTurns: number
  exitCode: number | undefined
  lastAgentOutput: string
  pendingPlaygroundPaths: PlaygroundWriteResult[]
  messagesConsumed: number
  lastEventType: string
}

/**
 * Handles the stream-stalled sentinel: emits a structured log event, emits
 * an agent:error event, and returns the stall result to the caller.
 */
function buildStalledStreamResult(ctx: MessageLoopContext): ConsumeMessagesResult {
  ctx.logger.event('agent.stream.error', {
    reason: 'stalled',
    taskId: ctx.task.id,
    messagesConsumed: ctx.messagesConsumed,
    lastEventType: ctx.lastEventType
  })
  const stallError = new Error('stream_stalled')
  emitAgentEvent(ctx.agentRunId, {
    type: 'agent:error',
    message: `Stream interrupted: stream stalled — no message in ${MESSAGE_STALL_TIMEOUT_MS / 1000}s`,
    timestamp: Date.now(),
    taskId: ctx.task.id,
    messagesConsumed: ctx.messagesConsumed,
    lastEventType: ctx.lastEventType
  })
  flushAgentEventBatcher()
  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    streamError: stallError,
    pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
  }
}

/**
 * Enforces the hard turn limit. If the limit is exceeded, aborts the handle,
 * emits an agent:error event, and returns the abort result. Returns null when
 * the turn count is within the limit (loop should continue).
 */
function enforceMaxTurns(
  turnCount: number,
  ctx: MessageLoopContext
): ConsumeMessagesResult | null {
  if (turnCount <= ctx.maxTurns) return null

  ctx.logger.warn(
    `[agent-manager] maxTurns (${ctx.maxTurns}) reached for task ${ctx.task.id} — aborting`
  )
  ctx.handle.abort()
  const turnsError = new Error('max_turns_exceeded')
  emitAgentEvent(ctx.agentRunId, {
    type: 'agent:error',
    message: turnsError.message,
    timestamp: Date.now(),
    taskId: ctx.task.id
  })
  flushAgentEventBatcher()
  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    streamError: turnsError,
    pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
  }
}

/**
 * Enforces the per-turn cost budget. If spending exceeds the cap, aborts the
 * handle, emits an agent:error event, and returns the abort result. Returns
 * null when spending is within budget (loop should continue).
 */
function enforceCostBudget(ctx: MessageLoopContext): ConsumeMessagesResult | null {
  if (ctx.agent.maxCostUsd === null || ctx.agent.costUsd < ctx.agent.maxCostUsd) return null

  ctx.logger.warn(
    `[agent-manager] Cost budget $${ctx.agent.maxCostUsd.toFixed(2)} exceeded ($${ctx.agent.costUsd.toFixed(2)} spent) — aborting task ${ctx.task.id}`
  )
  ctx.handle.abort()
  const budgetError = new Error(
    `Cost budget $${ctx.agent.maxCostUsd.toFixed(2)} exceeded ($${ctx.agent.costUsd.toFixed(2)} spent)`
  )
  emitAgentEvent(ctx.agentRunId, {
    type: 'agent:error',
    message: budgetError.message,
    timestamp: Date.now(),
    taskId: ctx.task.id
  })
  flushAgentEventBatcher()
  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    streamError: budgetError,
    pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
  }
}

/**
 * Handles an auth error thrown during stream iteration.
 *
 * Invalidates the cached OAuth token and attempts a Keychain refresh. When the
 * refresh succeeds, returns a clean result so the caller can retry. When it
 * fails, aborts the handle and returns an `OAuthRefreshFailedError` so the
 * caller can distinguish "auth failure already handled" from generic errors.
 */
async function handleAuthError(
  ctx: MessageLoopContext,
  onOAuthRefreshStart?: (promise: Promise<unknown>) => void
): Promise<ConsumeMessagesResult> {
  const refreshSucceeded = await handleOAuthRefresh(ctx.logger, onOAuthRefreshStart)
  if (refreshSucceeded) {
    // Token is fresh — caller can retry cleanly; no streamError.
    flushAgentEventBatcher()
    return {
      exitCode: ctx.exitCode,
      lastAgentOutput: ctx.lastAgentOutput,
      pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
    }
  }

  // Refresh failed: abort the handle and surface a typed error.
  ctx.handle.abort()
  const refreshError = new OAuthRefreshFailedError()
  emitAgentEvent(ctx.agentRunId, {
    type: 'agent:error',
    message: `Stream interrupted: OAuth refresh failed after auth error — stream aborted`,
    timestamp: Date.now(),
    taskId: ctx.task.id,
    messagesConsumed: ctx.messagesConsumed,
    lastEventType: ctx.lastEventType
  })
  flushAgentEventBatcher()
  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    streamError: refreshError,
    pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
  }
}

/**
 * Handles an unexpected error thrown during stream iteration.
 *
 * Detects auth errors (by message content) and delegates to `handleAuthError`
 * for token refresh. For all other errors, emits a structured log event and an
 * agent:error event, then returns the error as `streamError`.
 */
async function handleStreamError(
  err: unknown,
  ctx: MessageLoopContext,
  onOAuthRefreshStart?: (promise: Promise<unknown>) => void
): Promise<ConsumeMessagesResult> {
  const errMsg = err instanceof Error ? err.message : String(err)
  ctx.logger.event('agent.stream.error', {
    taskId: ctx.task.id,
    messagesConsumed: ctx.messagesConsumed,
    lastEventType: ctx.lastEventType,
    error: errMsg
  })
  logError(ctx.logger, `[agent-manager] Error consuming messages for task ${ctx.task.id}`, err)

  const isAuthError =
    errMsg.includes('Invalid API key') ||
    errMsg.includes('invalid_api_key') ||
    errMsg.includes('authentication') ||
    errMsg.includes('Not logged in') ||
    errMsg.includes('Please run /login')

  if (isAuthError) {
    return handleAuthError(ctx, onOAuthRefreshStart)
  }

  emitAgentEvent(ctx.agentRunId, {
    type: 'agent:error',
    message: `Stream interrupted: ${errMsg}`,
    timestamp: Date.now(),
    taskId: ctx.task.id,
    messagesConsumed: ctx.messagesConsumed,
    lastEventType: ctx.lastEventType
  })
  // Flush immediately: the batcher's 100ms timer may not fire before the
  // next drain tick or process shutdown, so the stream-error event would
  // be lost. Flushing here guarantees it reaches SQLite.
  flushAgentEventBatcher()
  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    streamError: err instanceof Error ? err : new Error(errMsg),
    pendingPlaygroundPaths: ctx.pendingPlaygroundPaths
  }
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
  maxTurns = 1000,
  onOAuthRefreshStart?: (promise: Promise<unknown>) => void
): Promise<ConsumeMessagesResult> {
  const pendingPlaygroundPaths: PlaygroundWriteResult[] = []
  const playgroundDetector = createPlaygroundDetector()
  let turnCount = 0

  const ctx: MessageLoopContext = {
    handle,
    agent,
    task,
    agentRunId,
    logger,
    maxTurns,
    exitCode: undefined,
    lastAgentOutput: '',
    pendingPlaygroundPaths,
    messagesConsumed: 0,
    lastEventType: 'none'
  }

  // Shared timer state reused across nextOrStall calls (T-41).
  const stallTimer: StallTimerState = { handle: undefined }
  const iter = handle.messages[Symbol.asyncIterator]()

  try {
    // Manual iteration instead of `for await` so each `iter.next()` call
    // can be raced against a per-message deadline. If no message arrives
    // within MESSAGE_STALL_TIMEOUT_MS the stream is declared stalled and
    // the loop exits early with a structured streamError.
    while (true) {
      const raceResult = await nextOrStall(iter, stallTimer)

      if (raceResult === STALL_SENTINEL) {
        return buildStalledStreamResult(ctx)
      }

      if (raceResult.done) break

      const msg = raceResult.value
      ctx.messagesConsumed++
      // Parse once per message — reused for lastEventType tracking, processSDKMessage,
      // and the hard turn-limit check below (T-42: eliminate duplicate asSDKMessage calls).
      const sdkMsg = asSDKMessage(msg)
      if (sdkMsg?.type) {
        ctx.lastEventType = sdkMsg.type
      }
      const result = processSDKMessage(
        msg,
        sdkMsg,
        agent,
        agentRunId,
        turnTracker,
        ctx.exitCode,
        ctx.lastAgentOutput
      )
      ctx.exitCode = result.exitCode
      ctx.lastAgentOutput = result.lastAgentOutput

      if (task.playground_enabled) {
        const playgroundHit = playgroundDetector.onMessage(msg)
        if (playgroundHit) pendingPlaygroundPaths.push(playgroundHit)
      }

      // Hard turn limit: abort if agent exceeds maxTurns (SDK soft limit may not enforce)
      if (sdkMsg?.type === 'assistant') {
        turnCount++
        const turnsResult = enforceMaxTurns(turnCount, ctx)
        if (turnsResult) return turnsResult
      }

      const budgetResult = enforceCostBudget(ctx)
      if (budgetResult) return budgetResult
    }
  } catch (err) {
    return handleStreamError(err, ctx, onOAuthRefreshStart)
  }

  return {
    exitCode: ctx.exitCode,
    lastAgentOutput: ctx.lastAgentOutput,
    pendingPlaygroundPaths
  }
}
