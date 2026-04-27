/**
 * Event query functions — extracted from agents/event-store.ts.
 * All functions take `db: Database.Database` as first parameter for testability.
 */
import type Database from 'better-sqlite3'
import { MS_PER_DAY } from '../../shared/time'

export function appendEvent(
  db: Database.Database,
  agentId: string,
  eventType: string,
  payload: string,
  timestamp: number
): void {
  db.prepare(
    'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
  ).run(agentId, eventType, payload, timestamp)
}

export function getEventHistory(db: Database.Database, agentId: string): { payload: string }[] {
  return db
    .prepare('SELECT payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC')
    .all(agentId) as { payload: string }[]
}

export function pruneOldEvents(db: Database.Database, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * MS_PER_DAY
  db.prepare('DELETE FROM agent_events WHERE timestamp < ?').run(cutoff)
}

// ---------------------------------------------------------------------------
// Batch insert
// ---------------------------------------------------------------------------

export interface EventBatchItem {
  agentId: string
  eventType: string
  payload: string
  timestamp: number
}

export function insertEventBatch(db: Database.Database, events: EventBatchItem[]): void {
  if (events.length === 0) return

  const insert = db.prepare(
    'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
  )

  const tx = db.transaction(() => {
    for (const e of events) {
      insert.run(e.agentId, e.eventType, e.payload, e.timestamp)
    }
  })
  tx()
}

// ---------------------------------------------------------------------------
// Query with filtering and pagination
// ---------------------------------------------------------------------------

export interface EventRow {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
}

export interface QueryEventsOptions {
  agentId?: string
  agentIds?: string[]
  eventType?: string
  afterTimestamp?: number
  limit?: number
}

export interface QueryEventsResult {
  events: EventRow[]
  hasMore: boolean
}

export function queryEvents(db: Database.Database, opts: QueryEventsOptions): QueryEventsResult {
  const conditions: string[] = []
  const params: unknown[] = []
  const limit = opts.limit ?? 200

  if (opts.agentId) {
    conditions.push('agent_id = ?')
    params.push(opts.agentId)
  } else if (opts.agentIds && opts.agentIds.length > 0) {
    const placeholders = opts.agentIds.map(() => '?').join(', ')
    conditions.push(`agent_id IN (${placeholders})`)
    params.push(...opts.agentIds)
  }

  if (opts.eventType) {
    conditions.push('event_type = ?')
    params.push(opts.eventType)
  }

  if (opts.afterTimestamp != null) {
    conditions.push('timestamp > ?')
    params.push(opts.afterTimestamp)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  // Fetch limit+1 to detect hasMore
  const sql = `SELECT * FROM agent_events ${where} ORDER BY timestamp ASC LIMIT ?`
  params.push(limit + 1)

  const rows = db.prepare(sql).all(...params) as EventRow[]
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  return { events: rows, hasMore }
}

// ---------------------------------------------------------------------------
// Prune events by agent IDs
// ---------------------------------------------------------------------------

export function pruneEventsByAgentIds(db: Database.Database, agentIds: string[]): void {
  if (agentIds.length === 0) return

  // DL-27: Batch large arrays to avoid SQLite variable limit (default 999)
  const BATCH_SIZE = 500
  if (agentIds.length > BATCH_SIZE) {
    // Process in batches
    for (let i = 0; i < agentIds.length; i += BATCH_SIZE) {
      const batch = agentIds.slice(i, i + BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(', ')
      db.prepare(`DELETE FROM agent_events WHERE agent_id IN (${placeholders})`).run(...batch)
    }
  } else {
    const placeholders = agentIds.map(() => '?').join(', ')
    db.prepare(`DELETE FROM agent_events WHERE agent_id IN (${placeholders})`).run(...agentIds)
  }
}
