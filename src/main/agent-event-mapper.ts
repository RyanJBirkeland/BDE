/**
 * Shared SDK message → AgentEvent mapping and emission.
 * Used by both adhoc-agent.ts (user-spawned) and run-agent.ts (AgentManager pipeline).
 */
import { broadcast } from './broadcast'
import { appendEvent } from './data/event-queries'
import { getDb } from './db'
import type { AgentEvent } from '../shared/types'

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
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            events.push({ type: 'agent:text', text: b.text, timestamp: now })
          } else if (b.type === 'tool_use') {
            const toolName =
              (typeof b.name === 'string' && b.name) ||
              (typeof b.tool_name === 'string' && b.tool_name) ||
              'unknown'
            events.push({
              type: 'agent:tool_call',
              tool: toolName,
              summary: toolName,
              input: b.input,
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
      summary: typeof content === 'string' ? content.slice(0, 200) : '',
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
    console.debug(`[agent-event-mapper] Unrecognized message type: ${msgType}`)
  }

  return events
}

// Rate-limited error logging for SQLite failures
let _lastSqliteErrorLog = 0
const SQLITE_ERROR_LOG_INTERVAL_MS = 60_000 // Log at most once per minute

/**
 * Broadcasts an AgentEvent via IPC and persists it to SQLite.
 * SQLite write failures are logged (rate-limited) but non-fatal — the real-time broadcast is the priority.
 */
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch (err) {
    // SQLite write failure is non-fatal, but log it (rate-limited)
    const now = Date.now()
    if (now - _lastSqliteErrorLog > SQLITE_ERROR_LOG_INTERVAL_MS) {
      console.warn(`[agent-event-mapper] SQLite write failed (will retry next event): ${err}`)
      _lastSqliteErrorLog = now
    }
  }
}
