/**
 * Converts parsed stream-json ChatItems into ChatMessages for ChatThread rendering.
 * Bridges the local agent log format to the shared chat UI.
 */
import type { ChatItem } from './stream-parser'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number | string
  toolName?: string
  toolArgs?: Record<string, unknown>
}

export function chatItemsToMessages(items: ChatItem[]): ChatMessage[] {
  return items.flatMap((item): ChatMessage[] => {
    switch (item.kind) {
      case 'text':
        return item.text.trim() ? [{ role: 'assistant', content: item.text }] : []
      case 'tool_use':
        return [{ role: 'tool', toolName: item.name, content: item.input }]
      case 'tool_result':
        return item.content.trim()
          ? [{ role: 'tool', toolName: 'Result', content: item.content }]
          : []
      case 'result': {
        const icon = item.subtype === 'success' ? '\u2713' : '\u2717'
        const label = item.result || (item.subtype === 'success' ? 'Done' : 'Failed')
        const cost = item.costUsd != null ? ` \u00B7 $${item.costUsd.toFixed(3)}` : ''
        return [{ role: 'system', content: `${icon} ${label}${cost}` }]
      }
      case 'plain':
        return item.text.trim() ? [{ role: 'system', content: item.text }] : []
      case 'error':
        return [{ role: 'system', content: `\u2717 Error: ${item.text}` }]
      default:
        return []
    }
  })
}
