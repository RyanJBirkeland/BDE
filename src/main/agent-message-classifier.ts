/**
 * Pure SDK wire-protocol message → AgentEvent classification.
 * No DB, IPC, or broadcast dependencies — safe to import anywhere.
 */
import { createLogger } from './logger'
import type { AgentEvent } from '../shared/types'
import { TOOL_RESULT_SUMMARY_MAX_CHARS } from './constants'

const logger = createLogger('agent-message-classifier')

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
