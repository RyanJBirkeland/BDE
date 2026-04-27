/**
 * Pure SDK wire-protocol message → AgentEvent classification.
 * No DB, IPC, or broadcast dependencies — safe to import anywhere.
 */
import { createLogger } from './logger'
import type { AgentEvent } from '../shared/types'
import { TOOL_RESULT_SUMMARY_MAX_CHARS } from './constants'

const logger = createLogger('agent-message-classifier')

function isSdkMessage(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null
}

function isContentBlock(block: unknown): block is Record<string, unknown> {
  return typeof block === 'object' && block !== null
}

function extractToolInput(block: Record<string, unknown>): Record<string, unknown> | null {
  const input = block.input
  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>
  return null
}

/**
 * Maps a raw SDK wire-protocol message to zero or more typed AgentEvents.
 * Handles assistant messages (text + tool_use blocks) and tool_result messages.
 */
export function mapRawMessage(raw: unknown): AgentEvent[] {
  if (!isSdkMessage(raw)) return []
  const now = Date.now()
  const events: AgentEvent[] = []

  const msgType = typeof raw.type === 'string' ? raw.type : undefined

  if (msgType === 'assistant') {
    const message = isContentBlock(raw.message) ? raw.message : undefined
    const content = message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isContentBlock(block)) continue
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ type: 'agent:text', text: block.text, timestamp: now })
        } else if (block.type === 'tool_use') {
          const toolName =
            (typeof block.name === 'string' && block.name) ||
            (typeof block.tool_name === 'string' && block.tool_name) ||
            'unknown'
          events.push({
            type: 'agent:tool_call',
            tool: toolName,
            summary: toolName,
            input: extractToolInput(block),
            timestamp: now
          })
        }
      }
    }
  } else if (msgType === 'result') {
    // SDK end-of-turn signal — not a tool result. Skip it.
  } else if (msgType === 'tool_result') {
    const content = raw.content ?? raw.output
    events.push({
      type: 'agent:tool_result',
      tool:
        (typeof raw.tool_name === 'string' && raw.tool_name) ||
        (typeof raw.name === 'string' && raw.name) ||
        'unknown',
      success: raw.is_error !== true,
      summary: typeof content === 'string' ? content.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) : '',
      output: content,
      timestamp: now
    })
  } else if (msgType) {
    // Log unrecognized message types for debugging
    logger.info(`Unrecognized message type: ${msgType}`)
  }

  return events
}
