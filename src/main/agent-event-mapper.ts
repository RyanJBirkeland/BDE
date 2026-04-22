/**
 * Shared SDK message → AgentEvent mapping and emission.
 * Used by both adhoc-agent.ts (user-spawned) and run-agent.ts (AgentManager pipeline).
 */
import type Database from 'better-sqlite3'
import { broadcastCoalesced } from './broadcast'
import { insertEventBatch, type EventBatchItem } from './data/event-queries'
import { getDb } from './db'
import { createLogger } from './logger'
import type { AgentEvent } from '../shared/types'
import { TOOL_RESULT_SUMMARY_MAX_CHARS, TOOL_RESULT_OUTPUT_MAX_CHARS } from './constants'

const logger = createLogger('agent-event-mapper')

/**
 * The SDK identifies a tool invocation with `tool_use_id`; only the preceding
 * assistant message carries the human-readable tool name. We remember the
 * mapping long enough to label the paired `tool_result` block when it comes
 * back in the next `user` message. Capped to avoid unbounded growth when a
 * session is long-lived or a tool_result is never returned.
 */
const MAX_TRACKED_TOOL_USE_IDS = 1000
const toolNameByToolUseId = new Map<string, string>()

function rememberToolName(toolUseId: string, toolName: string): void {
  if (toolNameByToolUseId.size >= MAX_TRACKED_TOOL_USE_IDS) {
    const oldest = toolNameByToolUseId.keys().next().value
    if (oldest !== undefined) toolNameByToolUseId.delete(oldest)
  }
  toolNameByToolUseId.set(toolUseId, toolName)
}

function consumeToolName(toolUseId: string): string {
  const name = toolNameByToolUseId.get(toolUseId) ?? 'unknown'
  toolNameByToolUseId.delete(toolUseId)
  return name
}

function capToolResultOutput(content: unknown): unknown {
  if (typeof content !== 'string') return content
  if (content.length <= TOOL_RESULT_OUTPUT_MAX_CHARS) return content
  return content.slice(0, TOOL_RESULT_OUTPUT_MAX_CHARS) + ' [truncated]'
}

function summarizeToolResultOutput(content: unknown): string {
  if (typeof content !== 'string') return ''
  return content.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS)
}

function buildToolResultEvent(
  tool: string,
  isError: boolean,
  content: unknown,
  timestamp: number
): AgentEvent {
  return {
    type: 'agent:tool_result',
    tool,
    success: isError !== true,
    summary: summarizeToolResultOutput(content),
    output: capToolResultOutput(content),
    timestamp
  }
}

function mapAssistantMessage(message: Record<string, unknown>, now: number): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = message?.content
  if (!Array.isArray(content)) return events
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const contentBlock = block as Record<string, unknown>
    if (contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
      events.push({ type: 'agent:text', text: contentBlock.text, timestamp: now })
      continue
    }
    if (contentBlock.type === 'tool_use') {
      const toolName =
        (typeof contentBlock.name === 'string' && contentBlock.name) ||
        (typeof contentBlock.tool_name === 'string' && contentBlock.tool_name) ||
        'unknown'
      if (typeof contentBlock.id === 'string') rememberToolName(contentBlock.id, toolName)
      events.push({
        type: 'agent:tool_call',
        tool: toolName,
        summary: toolName,
        input: contentBlock.input,
        timestamp: now
      })
    }
  }
  return events
}

function mapUserMessage(message: Record<string, unknown>, now: number): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = message?.content
  if (!Array.isArray(content)) return events
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const contentBlock = block as Record<string, unknown>
    if (contentBlock.type !== 'tool_result') continue
    const toolUseId = typeof contentBlock.tool_use_id === 'string' ? contentBlock.tool_use_id : ''
    const toolName = toolUseId ? consumeToolName(toolUseId) : 'unknown'
    events.push(
      buildToolResultEvent(
        toolName,
        contentBlock.is_error === true,
        contentBlock.content ?? contentBlock.output,
        now
      )
    )
  }
  return events
}

function mapTopLevelToolResult(msg: Record<string, unknown>, now: number): AgentEvent[] {
  const content = msg.content ?? msg.output
  const toolName =
    (typeof msg.tool_name === 'string' && msg.tool_name) ||
    (typeof msg.name === 'string' && msg.name) ||
    'unknown'
  return [buildToolResultEvent(toolName, msg.is_error === true, content, now)]
}

/**
 * Maps a raw SDK wire-protocol message to zero or more typed AgentEvents.
 * Handles assistant messages (text + tool_use blocks), user messages carrying
 * `tool_result` content blocks (current SDK format), and legacy top-level
 * `tool_result` messages (pre-SDK format, kept for back-compat).
 */
export function mapRawMessage(raw: unknown): AgentEvent[] {
  if (typeof raw !== 'object' || raw === null) return []
  const msg = raw as Record<string, unknown>
  const msgType = msg.type as string | undefined
  const now = Date.now()

  if (msgType === 'assistant') {
    return mapAssistantMessage((msg.message ?? {}) as Record<string, unknown>, now)
  }
  if (msgType === 'user') {
    return mapUserMessage((msg.message ?? {}) as Record<string, unknown>, now)
  }
  if (msgType === 'tool_result') {
    return mapTopLevelToolResult(msg, now)
  }
  if (msgType === 'result') {
    return []
  }
  if (msgType) {
    logger.info(`Unrecognized message type: ${msgType}`)
  }
  return []
}

const BATCH_SIZE = 50
const BATCH_INTERVAL_MS = 100
const MAX_CONSECUTIVE_FAILURES = 5
const MAX_PENDING_EVENTS = 10000

interface PendingRow {
  agentId: string
  event: AgentEvent
}

const _pending: PendingRow[] = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _consecutiveFailures = 0

// Rate-limited error logging for SQLite failures
let _lastSqliteErrorLog = 0
const SQLITE_ERROR_LOG_INTERVAL_MS = 60_000 // Log at most once per minute

/**
 * Scheduled timer callback — clears the timer reference then flushes.
 */
function scheduledFlush(): void {
  _flushTimer = null
  flushAgentEventBatcher()
}

/**
 * Flush all pending events to SQLite in a single transaction.
 * Called either when the batch reaches BATCH_SIZE or after BATCH_INTERVAL_MS.
 * Also called on agent manager shutdown to ensure no events are lost.
 */
export function flushAgentEventBatcher(db?: Database.Database): void {
  if (_pending.length === 0) return

  const rows = _pending.splice(0)
  try {
    const batch: EventBatchItem[] = rows.map(({ agentId, event }) => ({
      agentId,
      eventType: event.type,
      payload: JSON.stringify(event), // stringify deferred to here
      timestamp: event.timestamp
    }))
    insertEventBatch(db ?? getDb(), batch)
    _consecutiveFailures = 0
  } catch (err) {
    // SQLite write failure — re-queue events with circuit breaker
    _consecutiveFailures++
    if (_consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      _pending.unshift(...rows)
      if (_pending.length > MAX_PENDING_EVENTS) {
        const dropped = _pending.splice(0, _pending.length - MAX_PENDING_EVENTS)
        logger.warn(`Dropped ${dropped.length} oldest events (cap)`)
      }
    } else {
      logger.error(
        `${rows.length} events permanently lost after ${MAX_CONSECUTIVE_FAILURES} failures: ${err}`
      )
    }
    // Rate-limited error logging for context
    const now = Date.now()
    if (now - _lastSqliteErrorLog > SQLITE_ERROR_LOG_INTERVAL_MS) {
      logger.warn(`SQLite batch write failed (attempt ${_consecutiveFailures}): ${err}`)
      _lastSqliteErrorLog = now
    }
  }
}

/**
 * Persists an AgentEvent to SQLite, then broadcasts it via IPC.
 *
 * F-t1-concur-6: Order matters. Events are queued for batch persistence
 * (flush happens at BATCH_SIZE or BATCH_INTERVAL_MS), then broadcast
 * immediately. The broadcast is not blocked by SQLite writes. On shutdown,
 * flushAgentEventBatcher() is called to ensure no events are lost.
 */
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  // Queue the event (stringify deferred to flush)
  _pending.push({ agentId, event })

  if (_pending.length >= BATCH_SIZE) {
    // Batch full — flush immediately
    if (_flushTimer) {
      clearTimeout(_flushTimer)
      _flushTimer = null
    }
    flushAgentEventBatcher()
  } else if (!_flushTimer) {
    // Schedule a flush if not already scheduled
    _flushTimer = setTimeout(scheduledFlush, BATCH_INTERVAL_MS)
  }

  // Broadcast via coalesced batch channel (live tail UX via agent:event:batch)
  broadcastCoalesced('agent:event', { agentId, event })
}
