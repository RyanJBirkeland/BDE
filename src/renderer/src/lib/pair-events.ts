/**
 * pair-events.ts — Event pairing logic for chat rendering.
 * Converts AgentEvent[] into ChatBlock[], pairing tool_call + tool_result events.
 */
import type { AgentEvent } from '../../../shared/types'

// --- Chat Block Types (discriminated union) ---

/** Tool blocks that can appear inside a tool_group */
export type ToolBlock =
  | { type: 'tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | {
      type: 'tool_pair'
      tool: string
      summary: string
      input?: unknown | undefined
      result: { success: boolean; summary: string; output?: unknown }
      timestamp: number
    }

export type ChatBlock =
  | { type: 'started'; model: string; timestamp: number }
  | { type: 'text'; text: string; timestamp: number }
  | { type: 'user_message'; text: string; timestamp: number; pending?: boolean }
  | { type: 'thinking'; tokenCount: number; text?: string; timestamp: number }
  | ToolBlock
  | { type: 'tool_group'; tools: ToolBlock[]; timestamp: number }
  | { type: 'error'; message: string; timestamp: number }
  | { type: 'stderr'; text: string; timestamp: number }
  | { type: 'rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | {
      type: 'completed'
      exitCode: number
      costUsd: number
      tokensIn: number
      tokensOut: number
      durationMs: number
      timestamp: number
    }
  | {
      type: 'playground'
      filename: string
      html: string
      contentType: import('../../../shared/types').PlaygroundContentType
      sizeBytes: number
      timestamp: number
    }

// --- Event Pairing Logic ---

export function pairEvents(events: AgentEvent[]): ChatBlock[] {
  const blocks: ChatBlock[] = []

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!ev) continue

    switch (ev.type) {
      case 'agent:started':
        blocks.push({ type: 'started', model: ev.model, timestamp: ev.timestamp })
        break

      case 'agent:text':
        blocks.push({ type: 'text', text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:user_message':
        blocks.push({ type: 'user_message', text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:thinking':
        blocks.push({
          type: 'thinking',
          tokenCount: ev.tokenCount,
          ...(ev.text !== undefined ? { text: ev.text } : {}),
          timestamp: ev.timestamp
        })
        break

      case 'agent:tool_call': {
        const next = events[i + 1]
        if (next?.type === 'agent:tool_result' && next.tool === ev.tool) {
          blocks.push({
            type: 'tool_pair',
            tool: ev.tool,
            summary: ev.summary,
            input: ev.input,
            result: { success: next.success, summary: next.summary, output: next.output },
            timestamp: ev.timestamp
          })
          i++
        } else {
          blocks.push({
            type: 'tool_call',
            tool: ev.tool,
            summary: ev.summary,
            input: ev.input,
            timestamp: ev.timestamp
          })
        }
        break
      }

      case 'agent:tool_result':
        blocks.push({
          type: 'tool_call',
          tool: ev.tool,
          summary: ev.summary,
          timestamp: ev.timestamp
        })
        break

      case 'agent:error':
        blocks.push({ type: 'error', message: ev.message, timestamp: ev.timestamp })
        break

      case 'agent:stderr':
        blocks.push({ type: 'stderr', text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:rate_limited':
        blocks.push({
          type: 'rate_limited',
          retryDelayMs: ev.retryDelayMs,
          attempt: ev.attempt,
          timestamp: ev.timestamp
        })
        break

      case 'agent:completed':
        blocks.push({
          type: 'completed',
          exitCode: ev.exitCode,
          costUsd: ev.costUsd,
          tokensIn: ev.tokensIn,
          tokensOut: ev.tokensOut,
          durationMs: ev.durationMs,
          timestamp: ev.timestamp
        })
        break

      case 'agent:playground':
        blocks.push({
          type: 'playground',
          filename: ev.filename,
          html: ev.html,
          contentType: ev.contentType,
          sizeBytes: ev.sizeBytes,
          timestamp: ev.timestamp
        })
        break
    }
  }

  // Merge consecutive text blocks
  const merged: ChatBlock[] = []
  for (const block of blocks) {
    const prev = merged[merged.length - 1]
    if (block.type === 'text' && prev?.type === 'text') {
      prev.text += '\n' + block.text
    } else {
      merged.push(block)
    }
  }

  // Group consecutive tool blocks into collapsible tool_group blocks
  const grouped: ChatBlock[] = []
  for (const block of merged) {
    if (block.type === 'tool_call' || block.type === 'tool_pair') {
      const prev = grouped[grouped.length - 1]
      if (prev?.type === 'tool_group') {
        prev.tools.push(block)
      } else {
        grouped.push({ type: 'tool_group', tools: [block], timestamp: block.timestamp })
      }
    } else {
      grouped.push(block)
    }
  }

  return grouped
}
