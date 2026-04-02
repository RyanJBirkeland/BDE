/**
 * Queue API handlers for SSE events and task event persistence.
 */
import type http from 'node:http'
import { sendJson, parseBody } from './helpers'
import { createSseBroadcaster } from './sse-broadcaster'
import { insertEventBatch, queryEvents } from '../data/event-queries'
import { getDb } from '../db'
import { createLogger } from '../logger'

const logger = createLogger('queue-api:events')

// ---------------------------------------------------------------------------
// SSE broadcaster (singleton, re-exported by router.ts)
// ---------------------------------------------------------------------------

export const sseBroadcaster = createSseBroadcaster()

// ---------------------------------------------------------------------------
// Curated event types to persist to SQLite
// ---------------------------------------------------------------------------

const CURATED_EVENT_TYPES = new Set([
  'agent:started',
  'agent:tool_call',
  'agent:tool_result',
  'agent:rate_limited',
  'agent:error',
  'agent:completed'
])

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleEvents(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  sseBroadcaster.addClient(res)
}

export async function handleTaskOutput(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    // parseBody already sent 413 if payload too large
    if (!res.writableEnded) {
      sendJson(res, 400, { error: 'Invalid JSON body' })
    }
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { events, agentId } = body as { events?: unknown[]; agentId?: unknown }
  if (!Array.isArray(events)) {
    sendJson(res, 400, { error: 'events must be an array' })
    return
  }

  let persistedCount = 0

  // Broadcast each event to connected SSE clients
  for (const event of events) {
    // QA-28: Use actual event type from the event instead of hardcoded 'task:output'
    const eventObj = event as Record<string, unknown>
    const eventType = typeof eventObj['type'] === 'string' ? eventObj['type'] : 'task:output'
    sseBroadcaster.broadcast(eventType, { taskId, ...eventObj })
  }

  // Persist curated event types to SQLite (best-effort)
  try {
    const resolvedAgentId = typeof agentId === 'string' && agentId ? agentId : taskId
    const now = Date.now()
    const batch = events
      .filter((e): e is Record<string, unknown> => {
        return (
          typeof e === 'object' &&
          e !== null &&
          CURATED_EVENT_TYPES.has((e as Record<string, unknown>)['type'] as string)
        )
      })
      .map((e) => ({
        agentId: resolvedAgentId,
        eventType: e['type'] as string,
        payload: JSON.stringify(e),
        timestamp:
          typeof e['timestamp'] === 'string'
            ? new Date(e['timestamp'] as string).getTime() || now
            : now
      }))
    if (batch.length > 0) {
      insertEventBatch(getDb(), batch)
      persistedCount = batch.length
    }
  } catch (err) {
    // QA-17: Log event persistence errors for debugging
    logger.error(
      `Failed to persist events for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
    )
    // Best-effort — do not fail the request
  }

  // QA-29: Return resource information instead of just {ok: true}
  sendJson(res, 200, {
    taskId,
    eventsReceived: events.length,
    eventsPersisted: persistedCount
  })
}

export async function handleTaskEvents(
  res: http.ServerResponse,
  taskId: string,
  query: URLSearchParams
): Promise<void> {
  const eventType = query.get('eventType') ?? undefined
  const afterTimestampRaw = query.get('afterTimestamp')
  const afterTimestamp =
    afterTimestampRaw != null ? parseInt(afterTimestampRaw, 10) || undefined : undefined
  const limitRaw = query.get('limit')
  const limit =
    limitRaw != null ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 200, 1000)) : undefined

  const result = queryEvents(getDb(), { agentId: taskId, eventType, afterTimestamp, limit })

  sendJson(res, 200, {
    events: result.events.map((e) => ({
      id: e.id,
      agentId: e.agent_id,
      eventType: e.event_type,
      payload: e.payload,
      timestamp: e.timestamp
    })),
    hasMore: result.hasMore
  })
}
