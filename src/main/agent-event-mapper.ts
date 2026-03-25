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
            events.push({
              type: 'agent:tool_call',
              tool: (b.name as string) ?? 'unknown',
              summary: (b.name as string) ?? '',
              input: b.input,
              timestamp: now,
            })
          }
        }
      }
    }
  } else if (msgType === 'tool_result' || msgType === 'result') {
    const content = msg.content ?? msg.output
    events.push({
      type: 'agent:tool_result',
      tool: (msg.tool_name as string) ?? (msg.name as string) ?? 'unknown',
      success: msg.is_error !== true,
      summary: typeof content === 'string' ? content.slice(0, 200) : '',
      output: content,
      timestamp: now,
    })
  }

  return events
}

/**
 * Broadcasts an AgentEvent via IPC and persists it to SQLite.
 * SQLite write failures are swallowed — the real-time broadcast is the priority.
 */
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch {
    // SQLite write failure is non-fatal
  }
}
