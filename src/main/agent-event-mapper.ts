/**
 * Shared SDK message → AgentEvent mapping and emission.
 * Used by both adhoc-agent.ts (user-spawned) and run-agent.ts (AgentManager pipeline).
 */
import { broadcast } from './broadcast'
import { insertEventBatch, type EventBatchItem } from './data/event-queries'
import { getDb } from './db'
import { createLogger } from './logger'
import type { AgentEvent } from '../shared/types'
import { TOOL_RESULT_SUMMARY_MAX_CHARS } from './constants'

const logger = createLogger('agent-event-mapper')

/**
 * Maps a raw SDK wire-protocol message to zero or more typed AgentEvents.
 * Handles assistant messages (text + tool_use blocks) and tool_result messages.
 */
export function mapRawMessage(raw: unknown): AgentEvent[] {
  if (typeof raw !== 'object' || raw === null) return []
  const msg = raw as Record<string, unknown>
  const now = Date.now()
  const events: AgentEvent[] = []

  const msgType = msg.type as string | undefined

  if (msgType === 'assistant') {
    const message = msg.message as Record<string, unknown> | undefined
    const content = message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null) {
          const contentBlock = block as Record<string, unknown>
          if (contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
            events.push({ type: 'agent:text', text: contentBlock.text, timestamp: now })
          } else if (contentBlock.type === 'tool_use') {
            const toolName =
              (typeof contentBlock.name === 'string' && contentBlock.name) ||
              (typeof contentBlock.tool_name === 'string' && contentBlock.tool_name) ||
              'unknown'
            events.push({
              type: 'agent:tool_call',
              tool: toolName,
              summary: toolName,
              input: contentBlock.input,
              timestamp: now
            })
          }
        }
      }
    }
  } else if (msgType === 'result') {
    // SDK end-of-turn signal — not a tool result. Skip it.
  } else if (msgType === 'tool_result') {
    const content = msg.content ?? msg.output
    events.push({
      type: 'agent:tool_result',
      tool:
        (typeof msg.tool_name === 'string' && msg.tool_name) ||
        (typeof msg.name === 'string' && msg.name) ||
        'unknown',
      success: msg.is_error !== true,
      summary: typeof content === 'string' ? content.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) : '',
      output: content,
      timestamp: now
    })
  } else if (
    msgType &&
    msgType !== 'assistant' &&
    msgType !== 'tool_result' &&
    msgType !== 'result'
  ) {
    // Log unrecognized message types for debugging
    logger.info(`Unrecognized message type: ${msgType}`)
  }

  return events
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
export function flushAgentEventBatcher(): void {
  if (_pending.length === 0) return

  const rows = _pending.splice(0)
  try {
    const batch: EventBatchItem[] = rows.map(({ agentId, event }) => ({
      agentId,
      eventType: event.type,
      payload: JSON.stringify(event), // stringify deferred to here
      timestamp: event.timestamp
    }))
    insertEventBatch(getDb(), batch)
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

  // Broadcast immediately (live tail UX)
  broadcast('agent:event', { agentId, event })
}
