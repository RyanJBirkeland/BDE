/**
 * Agent event persistence and broadcast.
 * Batches events for SQLite writes while broadcasting immediately for live tail UX.
 */
import { broadcast } from './broadcast'
import { insertEventBatch, type EventBatchItem } from './data/event-queries'
import { getDb } from './db'
import { createLogger } from './logger'
import type { AgentEvent } from '../shared/types'

const logger = createLogger('agent-event-persister')

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
