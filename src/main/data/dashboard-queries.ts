/**
 * Dashboard query functions — wrapper layer for dashboard handlers.
 * Delegates to agent-queries.ts for actual SQL execution.
 */
import type Database from 'better-sqlite3'
import { getDb } from '../db'
import {
  getCompletionsPerHour as _getCompletionsPerHour,
  getRecentEvents as _getRecentEvents
} from './agent-queries'

export function getCompletionsPerHour(db?: Database.Database): {
  hour: string
  successCount: number
  failedCount: number
}[] {
  return _getCompletionsPerHour(db ?? getDb())
}

export function getRecentEvents(
  limit: number = 20,
  db?: Database.Database
): {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
  task_title: string | null
}[] {
  return _getRecentEvents(db ?? getDb(), limit)
}
